import { Component, DestroyRef, ElementRef, afterNextRender, effect, inject, input, untracked } from '@angular/core';

/**
 * The browser build's `<dom-component>`. On a phone, `@ng-native/expo`'s element shows the page
 * in Expo's web view; in a browser there is no web view, so this one shows the same page in an
 * iframe and speaks the same protocol to it: the inputs go in before load (here through the
 * frame's `window.name`), later inputs go to `window.__ngNative.receive`, and the page posts
 * `ready`, `output` and `error` messages as JSON strings. Only messages from its own frame count.
 *
 * Vite aliases `@ng-native/expo/dom-component` to this file for the browser build only.
 */

export type DomComponentOutputHandler = (value: never) => void;

export interface DomComponentReference {
  readonly domComponent: string;
}

interface PageWindow extends Window {
  __ngNative?: { receive(message: unknown): void };
}

@Component({
  selector: 'dom-component',
  template: '',
})
export class DomComponent {
  readonly src = input.required<DomComponentReference>();
  readonly inputs = input<Readonly<Record<string, unknown>>>({});
  readonly outputs = input<Readonly<Record<string, DomComponentOutputHandler>>>({});

  private frame: HTMLIFrameElement | null = null;
  private ready = false;

  constructor() {
    const node = inject(ElementRef).nativeElement as { el: HTMLElement };
    const onMessage = (event: MessageEvent) => {
      if (!this.frame || event.source !== this.frame.contentWindow) return;
      const envelope = event.data as { __bwbtDom?: boolean; data?: string };
      if (!envelope?.__bwbtDom || typeof envelope.data !== 'string') return;
      this.receive(envelope.data);
    };

    afterNextRender(() => {
      const host = node.el;
      host.style.position = 'relative';
      const frame = document.createElement('iframe');
      frame.title = 'game';
      frame.setAttribute('allow', 'autoplay; fullscreen');
      frame.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;display:block;background:transparent';
      frame.name = JSON.stringify({ inputs: untracked(this.inputs) });
      frame.src = this.src().domComponent;
      host.appendChild(frame);
      this.frame = frame;
      window.addEventListener('message', onMessage);
    });

    effect(() => {
      const inputs = this.inputs();
      if (this.ready) untracked(() => this.send(inputs));
    });

    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('message', onMessage);
      // Removing the frame unloads its page, as unmounting the native web view does.
      this.frame?.remove();
      this.frame = null;
    });
  }

  private receive(data: string): void {
    let message: { type?: string; name?: string; value?: unknown; outputs?: string[]; message?: string };
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    if (message.type === 'ready') {
      const declared = message.outputs ?? [];
      for (const name of Object.keys(this.outputs())) {
        if (!declared.includes(name)) throw new Error(`<dom-component> has no output '${name}' (its outputs: ${declared.join(', ')})`);
      }
      this.ready = true;
      this.send(this.inputs());
    } else if (message.type === 'output' && message.name) {
      const handlers = this.outputs();
      if (Object.hasOwn(handlers, message.name)) handlers[message.name](message.value as never);
    } else if (message.type === 'error') {
      throw new Error(`<dom-component>: ${message.message}`);
    }
  }

  private send(inputs: Readonly<Record<string, unknown>>): void {
    const page = this.frame?.contentWindow as PageWindow | null | undefined;
    // A round trip through JSON, exactly what the native bridge does to every input.
    page?.__ngNative?.receive(JSON.parse(JSON.stringify({ type: 'inputs', inputs })));
  }
}
