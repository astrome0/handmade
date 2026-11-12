// Phone or tablet? Then the game draws lighter (smaller shadows, less grass, lower resolution, no antialiasing).
// Decided once at start. To try the phone settings on a computer add ?mobile=1, to force the full ones ?pc=1.
const q = location.search;
export const MOBILE = /[?&](mobile|touch)=1/.test(q) || (!/[?&]pc=1/.test(q) && matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0);
