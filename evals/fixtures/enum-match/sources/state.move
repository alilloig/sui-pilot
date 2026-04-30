module state::state;

const IDLE: u8 = 0;
const RUNNING: u8 = 1;
const DONE: u8 = 2;

public struct State has copy, drop, store {
    tag: u8,
}

public fun new(): State {
    State { tag: IDLE }
}

public fun step(s: &mut State) {
    if (s.tag == IDLE) {
        s.tag = RUNNING;
    } else if (s.tag == RUNNING) {
        s.tag = DONE;
    } else {
        // already DONE — no-op
    };
}
