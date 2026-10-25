import { Component } from '@angular/core';

/**
 * The global stylesheet: the Arabic face every screen uses and the colour tokens. Never rendered;
 * `main.ts` passes its compiled sheet to `loadFonts()` and to `mount()` as `globalStyles`.
 */
@Component({
  selector: 'bwbt-global-styles',
  template: '',
  styleUrl: './global.css',
})
export class GlobalStyles {}
