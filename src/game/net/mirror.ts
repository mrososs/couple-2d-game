import Phaser from 'phaser';
import type { ObjectDelta, SceneDelta } from './protocol.ts';

/**
 * Display mirroring for two-phone play. The host's game runs every rule; what the guest needs is
 * the picture. `SceneMirror` walks a scene's display list on the host and reports each object's
 * drawable state - position, texture and frame, text, shape, graphics commands - sending only the
 * fields that changed. `SceneReplica` builds and updates matching objects on the guest.
 *
 * Mirroring the picture instead of each level's state keeps the network layer independent of the
 * levels: a level written for one phone plays on two without a line of network code.
 */

type GO = Phaser.GameObjects.GameObject & Record<string, unknown>;

const round = (v: number, places = 1) => {
  const f = 10 ** places;
  return Math.round(v * f) / f;
};

/** Objects the host keeps to itself: invisible helpers, and anything tagged local-only. */
function skip(obj: GO): boolean {
  const type = obj.type;
  if (type === 'Zone' || type === 'ParticleEmitter') return true;
  return (obj as unknown as Phaser.GameObjects.GameObject).getData?.('local') === true;
}

function textStyle(t: Phaser.GameObjects.Text): Record<string, unknown> {
  const s = t.style;
  return {
    fontFamily: s.fontFamily,
    fontSize: s.fontSize,
    fontStyle: s.fontStyle,
    color: s.color,
    backgroundColor: s.backgroundColor,
    align: s.align,
    rtl: s.rtl,
    stroke: s.stroke,
    strokeThickness: s.strokeThickness,
    lineSpacing: t.lineSpacing,
    wordWrapWidth: s.wordWrapWidth,
    padding: { ...t.padding },
  };
}

function shapeFields(s: Phaser.GameObjects.Shape, f: Record<string, unknown>): void {
  f.fc = s.fillColor;
  f.fa = s.fillAlpha;
  f.f1 = s.isFilled ? 1 : 0;
  f.lc = s.strokeColor;
  f.la = s.strokeAlpha;
  f.lw = s.lineWidth;
  f.s1 = s.isStroked ? 1 : 0;
  f.ox = s.originX;
  f.oy = s.originY;
}

/** The drawable state of one object, as plain JSON fields. */
function fieldsOf(obj: GO, idOf: (o: GO) => number): Record<string, unknown> {
  const o = obj as unknown as Phaser.GameObjects.Image;
  const f: Record<string, unknown> = {
    t: obj.type,
    x: round(o.x),
    y: round(o.y),
    d: round(o.depth ?? 0, 2),
    // Hidden on the host but meant for the guest's eyes (a private hint): shown there.
    v: o.visible || o.getData?.('guestOnly') === true ? 1 : 0,
    a: round(o.alpha ?? 1, 2),
    sx: round(o.scaleX ?? 1, 3),
    sy: round(o.scaleY ?? 1, 3),
    r: round(o.rotation ?? 0, 3),
  };
  switch (obj.type) {
    case 'Image':
    case 'Sprite': {
      f.k = o.texture.key;
      f.f = o.frame.name;
      f.ox = round(o.originX, 3);
      f.oy = round(o.originY, 3);
      f.fx = o.flipX ? 1 : 0;
      f.bm = o.blendMode;
      f.tn = (o as unknown as { tintTopLeft?: number }).tintTopLeft ?? 0xffffff;
      break;
    }
    case 'Text': {
      const t = obj as unknown as Phaser.GameObjects.Text;
      f.tx = t.text;
      f.st = textStyle(t);
      f.ox = round(t.originX, 3);
      f.oy = round(t.originY, 3);
      break;
    }
    case 'Graphics':
      f.cb = [...(obj as unknown as Phaser.GameObjects.Graphics).commandBuffer];
      break;
    case 'Rectangle': {
      const r = obj as unknown as Phaser.GameObjects.Rectangle;
      f.w = r.width;
      f.h = r.height;
      shapeFields(r, f);
      break;
    }
    case 'Arc': {
      const a = obj as unknown as Phaser.GameObjects.Arc;
      f.rad = a.radius;
      shapeFields(a, f);
      break;
    }
    case 'Triangle': {
      const tri = (obj as unknown as Phaser.GameObjects.Triangle).geom as Phaser.Geom.Triangle;
      f.pts = [tri.x1, tri.y1, tri.x2, tri.y2, tri.x3, tri.y3];
      shapeFields(obj as unknown as Phaser.GameObjects.Shape, f);
      break;
    }
    case 'Container':
      f.ch = (obj as unknown as Phaser.GameObjects.Container).list.filter((c) => !skip(c as GO)).map((c) => idOf(c as GO));
      break;
  }
  return f;
}

export class SceneMirror {
  private readonly ids = new WeakMap<object, number>();
  private next = 1;
  private readonly sent = new Map<number, Record<string, string>>();

  /** `roots` limits what is mirrored (the HUD's level widget); by default, the whole scene. */
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly roots?: () => readonly Phaser.GameObjects.GameObject[],
  ) {}

  idOf(obj: object): number {
    let id = this.ids.get(obj);
    if (!id) {
      id = this.next++;
      this.ids.set(obj, id);
    }
    return id;
  }

  /** What changed since the last call; everything when `full`. */
  collect(full: boolean): SceneDelta {
    const out: ObjectDelta[] = [];
    const seen = new Set<number>();
    const visit = (obj: GO) => {
      if (skip(obj) || !obj.active) return;
      const id = this.idOf(obj);
      seen.add(id);
      const fields = fieldsOf(obj, (c) => this.idOf(c));
      const before = full ? undefined : this.sent.get(id);
      const changed: Record<string, unknown> = {};
      const record: Record<string, string> = {};
      let any = false;
      for (const [k, v] of Object.entries(fields)) {
        const json = JSON.stringify(v);
        record[k] = json;
        if (!before || before[k] !== json) {
          changed[k] = v;
          any = true;
        }
      }
      this.sent.set(id, record);
      if (any) out.push({ id, ...changed });
      if (obj.type === 'Container') for (const child of (obj as unknown as Phaser.GameObjects.Container).list) visit(child as GO);
    };
    const roots = this.roots ? this.roots() : this.scene.children.list;
    for (const obj of roots) visit(obj as GO);
    const rm: number[] = [];
    for (const id of this.sent.keys()) {
      if (!seen.has(id)) {
        rm.push(id);
        this.sent.delete(id);
      }
    }
    return { o: out, rm };
  }

  /** Forget what was sent, so the next collect is complete (a guest joined or rejoined). */
  reset(): void {
    this.sent.clear();
  }
}

/** Positions are eased between snapshots; a jump this far is a teleport and snaps. */
const SNAP_DISTANCE = 220;

export class SceneReplica {
  private readonly objects = new Map<number, Phaser.GameObjects.GameObject>();
  private readonly targets = new Map<number, { x: number; y: number }>();
  private readonly containers = new Map<number, number[]>();

  constructor(
    private readonly scene: Phaser.Scene,
    /** Makes sure a texture key exists before an image uses it; false falls back to a blank. */
    private readonly ensureTexture: (key: string) => boolean,
    /** Where top-level replicated objects go (the HUD puts them in a layer of its own). */
    private readonly parent?: Phaser.GameObjects.Container,
  ) {}

  get(id: number): Phaser.GameObjects.GameObject | undefined {
    return this.objects.get(id);
  }

  apply(delta: SceneDelta, full: boolean): void {
    if (full) {
      const keep = new Set(delta.o.map((o) => o.id));
      for (const id of [...this.objects.keys()]) if (!keep.has(id)) this.remove(id);
    }
    for (const od of delta.o) this.update(od);
    for (const id of delta.rm) this.remove(id);
    this.relink();
  }

  /** Eases replicated positions towards their latest values; call every frame. */
  step(): void {
    for (const [id, target] of this.targets) {
      const obj = this.objects.get(id) as unknown as Phaser.GameObjects.Components.Transform | undefined;
      if (!obj) continue;
      const dx = target.x - obj.x;
      const dy = target.y - obj.y;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
        obj.x = target.x;
        obj.y = target.y;
        continue;
      }
      obj.x += dx * 0.35;
      obj.y += dy * 0.35;
    }
  }

  clear(): void {
    for (const id of [...this.objects.keys()]) this.remove(id);
  }

  private update(od: ObjectDelta): void {
    let obj = this.objects.get(od.id);
    if (!obj && typeof od.t === 'string') {
      obj = this.create(od);
      if (!obj) return;
      this.objects.set(od.id, obj);
      this.parent?.add(obj);
    }
    if (!obj) return;
    const o = obj as unknown as Phaser.GameObjects.Image;
    const f = od as Record<string, unknown>;
    const isNew = !this.targets.has(od.id);
    if ('x' in f || 'y' in f) {
      const target = { x: (f.x as number) ?? this.targets.get(od.id)?.x ?? o.x, y: (f.y as number) ?? this.targets.get(od.id)?.y ?? o.y };
      if (isNew || Math.hypot(target.x - o.x, target.y - o.y) > SNAP_DISTANCE) o.setPosition(target.x, target.y);
      this.targets.set(od.id, target);
    }
    if ('d' in f) o.setDepth(f.d as number);
    if ('v' in f) o.setVisible(f.v === 1);
    if ('a' in f) o.setAlpha(f.a as number);
    if ('sx' in f || 'sy' in f) o.setScale((f.sx as number) ?? o.scaleX, (f.sy as number) ?? o.scaleY);
    if ('r' in f) o.setRotation(f.r as number);
    switch (obj.type) {
      case 'Image':
      case 'Sprite':
        if ('k' in f || 'f' in f) {
          const key = (f.k as string) ?? o.texture.key;
          if (this.ensureTexture(key)) o.setTexture(key, (f.f as string) ?? o.frame.name);
        }
        if ('ox' in f || 'oy' in f) o.setOrigin((f.ox as number) ?? o.originX, (f.oy as number) ?? o.originY);
        if ('fx' in f) o.setFlipX(f.fx === 1);
        if ('bm' in f) o.setBlendMode(f.bm as number);
        if ('tn' in f) o.setTint(f.tn as number);
        break;
      case 'Text': {
        const t = obj as unknown as Phaser.GameObjects.Text;
        if ('st' in f) {
          const { padding, lineSpacing, wordWrapWidth, ...style } = f.st as Record<string, unknown>;
          t.setStyle(style);
          t.setRTL(!!style.rtl);
          t.setWordWrapWidth((wordWrapWidth as number) ?? null, true);
          t.setLineSpacing((lineSpacing as number) ?? 0);
          t.setPadding(padding as Phaser.Types.GameObjects.Text.TextPadding);
        }
        if ('tx' in f) t.setText(f.tx as string);
        if ('ox' in f || 'oy' in f) t.setOrigin((f.ox as number) ?? t.originX, (f.oy as number) ?? t.originY);
        break;
      }
      case 'Graphics':
        if ('cb' in f) {
          const g = obj as unknown as Phaser.GameObjects.Graphics;
          g.clear();
          g.commandBuffer.push(...(f.cb as unknown[]));
        }
        break;
      case 'Rectangle':
      case 'Arc':
      case 'Triangle': {
        const s = obj as unknown as Phaser.GameObjects.Shape;
        if (obj.type === 'Rectangle' && ('w' in f || 'h' in f)) (s as Phaser.GameObjects.Rectangle).setSize((f.w as number) ?? s.width, (f.h as number) ?? s.height);
        if (obj.type === 'Arc' && 'rad' in f) (s as Phaser.GameObjects.Arc).setRadius(f.rad as number);
        if (obj.type === 'Triangle' && 'pts' in f) {
          const [x1, y1, x2, y2, x3, y3] = f.pts as number[];
          (s as Phaser.GameObjects.Triangle).setTo(x1, y1, x2, y2, x3, y3);
        }
        if ('fc' in f || 'fa' in f || 'f1' in f) {
          if ((f.f1 ?? (s.isFilled ? 1 : 0)) === 1) s.setFillStyle((f.fc as number) ?? s.fillColor, (f.fa as number) ?? s.fillAlpha);
          else s.isFilled = false;
        }
        if ('lc' in f || 'la' in f || 'lw' in f || 's1' in f) {
          if ((f.s1 ?? (s.isStroked ? 1 : 0)) === 1) s.setStrokeStyle((f.lw as number) ?? s.lineWidth, (f.lc as number) ?? s.strokeColor, (f.la as number) ?? s.strokeAlpha);
          else s.isStroked = false;
        }
        if ('ox' in f || 'oy' in f) s.setOrigin((f.ox as number) ?? s.originX, (f.oy as number) ?? s.originY);
        break;
      }
      case 'Container':
        if ('ch' in f) this.containers.set(od.id, f.ch as number[]);
        break;
    }
  }

  private create(od: ObjectDelta): Phaser.GameObjects.GameObject | undefined {
    const add = this.scene.add;
    switch (od.t) {
      case 'Image':
      case 'Sprite': {
        const key = (od.k as string) ?? '__DEFAULT';
        const ok = this.ensureTexture(key);
        return od.t === 'Sprite' ? add.sprite(0, 0, ok ? key : '__DEFAULT', od.f as string) : add.image(0, 0, ok ? key : '__DEFAULT', od.f as string);
      }
      case 'Text':
        return add.text(0, 0, '');
      case 'Graphics':
        return add.graphics();
      case 'Rectangle':
        return add.rectangle(0, 0, (od.w as number) ?? 1, (od.h as number) ?? 1);
      case 'Arc':
        return add.circle(0, 0, (od.rad as number) ?? 1);
      case 'Triangle':
        return add.triangle(0, 0, 0, 0, 1, 0, 0, 1);
      case 'Container':
        return add.container(0, 0);
      default:
        return undefined;
    }
  }

  /** Puts children into their containers, in order, once every object of a snapshot exists. */
  private relink(): void {
    for (const [id, children] of this.containers) {
      const container = this.objects.get(id) as Phaser.GameObjects.Container | undefined;
      if (!container) continue;
      const list = children.map((c) => this.objects.get(c)).filter((c): c is Phaser.GameObjects.GameObject => !!c);
      const same = list.length === container.list.length && list.every((c, i) => container.list[i] === c);
      if (same) continue;
      for (const child of list) {
        (child as Phaser.GameObjects.GameObject & { parentContainer?: Phaser.GameObjects.Container }).parentContainer?.remove(child);
      }
      container.add(list);
    }
  }

  private remove(id: number): void {
    const obj = this.objects.get(id);
    this.objects.delete(id);
    this.targets.delete(id);
    this.containers.delete(id);
    obj?.destroy();
  }
}
