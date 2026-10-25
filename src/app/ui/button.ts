import { Component, input, output } from '@angular/core';
import { Pressable, Text, View } from '@ng-native/components';

/** A chunky cartoon button: a coloured face on a darker base that it sinks into when pressed. */
@Component({
  selector: 'bwbt-button',
  imports: [Pressable, Text, View],
  template: `
    <pressable
      #p="pressable"
      class="btn"
      accessibilityRole="button"
      [accessibilityLabel]="label()"
      [accessibilityState]="{ disabled: disabled() }"
      [disabled]="disabled()"
      [attr.data-variant]="variant()"
      [attr.data-size]="size()"
      [attr.data-down]="p.pressed() ? 'yes' : 'no'"
      [attr.data-disabled]="disabled() ? 'yes' : 'no'"
      [testID]="testID()"
      (press)="tap.emit()"
    >
      <view class="face">
        @if (icon()) {
          <text class="icon">{{ icon() }}</text>
        }
        <text class="label" [numberOfLines]="2">{{ label() }}</text>
      </view>
    </pressable>
  `,
  styles: `
    .btn {
      border-radius: 20px;
      background-color: #3b2416;
      padding-bottom: 5px;
    }
    .btn[data-down='yes'] {
      padding-bottom: 1px;
      margin-top: 4px;
    }
    .btn[data-disabled='yes'] {
      opacity: 0.45;
    }
    .face {
      flex-direction: row;
      align-items: center;
      justify-content: center;
      gap: 10px;
      min-height: 48px;
      border-radius: 20px;
      border-width: 3px;
      border-color: #3b2416;
      padding: 10px 22px;
      background-color: #e8735a;
    }
    /* The label may wrap or shrink, but always inside the face. */
    .label {
      flex-shrink: 1;
      font-family: 'Baloo Bhaijaan 2';
      font-weight: 800;
      font-size: 20px;
      line-height: 30px;
      text-align: center;
      color: #fffbf5;
    }
    .icon {
      font-size: 20px;
    }
    .btn[data-variant='secondary'] .face {
      background-color: #2a9d8f;
    }
    .btn[data-variant='sun'] .face {
      background-color: #f2c14e;
    }
    .btn[data-variant='sun'] .label {
      color: #3b2416;
    }
    .btn[data-variant='ghost'] .face {
      background-color: #fffbf5;
    }
    .btn[data-variant='ghost'] .label {
      color: #3b2416;
    }
    .btn[data-variant='danger'] .face {
      background-color: #d9534f;
    }
    .btn[data-size='lg'] .face {
      padding: 14px 34px;
    }
    .btn[data-size='lg'] .label {
      font-size: 26px;
      line-height: 38px;
    }
    .btn[data-size='sm'] .face {
      padding: 6px 14px;
    }
    .btn[data-size='sm'] .label {
      font-size: 16px;
      line-height: 24px;
    }
    .btn[data-size='sm'] .face {
      min-height: 38px;
    }
  `,
})
export class Button {
  readonly label = input.required<string>();
  readonly icon = input('');
  readonly variant = input<'primary' | 'secondary' | 'sun' | 'ghost' | 'danger'>('primary');
  readonly size = input<'sm' | 'md' | 'lg'>('md');
  readonly disabled = input(false);
  /** For tests and UI automation (Maestro, adb). */
  readonly testID = input<string | undefined>(undefined);
  readonly tap = output<void>();
}
