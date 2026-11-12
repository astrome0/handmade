// Shared state so modules can reach each other without import cycles.
export const game = {
  scene: null,
  camera: null,
  renderer: null,
  player: null,
  tools: null,
  hud: null,
  vm: null,
  day: null,
  uTime: { value: 0 },
  input: {
    lmb: false, rmb: false,          // held
    lmbDown: false, rmbDown: false,  // pressed this frame
    keys: new Set(),                 // held key codes
    pressed: new Set(),              // pressed this frame
  },
  playing: false,
  driving: false,   // in the pickup
  forcePlay: false, // tests: run the game without pointer lock
  started: false,   // a game is going (new or loaded); before that the menu shows the empty forest
  id: null,         // this game's id (kept in its saves)
  playTime: 0,      // seconds played in this game (saved)
};
