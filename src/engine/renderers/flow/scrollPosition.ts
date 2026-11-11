/** Carry device-pixel rounding error between writes, including the tiny animation tail. */
export class ScrollPosition {
  private remainder = 0;
  reset(): void {
    this.remainder = 0;
  }
  by(scroller: HTMLElement, px: number, scale = window.devicePixelRatio || 1): void {
    if (!Number.isFinite(px)) return;
    const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const wanted = Math.max(0, Math.min(max, scroller.scrollTop + this.remainder + px));
    scroller.scrollTop = Math.max(0, Math.min(max, Math.round(wanted * scale) / scale));
    this.remainder = wanted <= 0 || wanted >= max ? 0 : wanted - scroller.scrollTop;
  }
}
