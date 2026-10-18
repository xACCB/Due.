// Monotonic id source for new tasks/subtasks -- plain Date.now() can collide when
// two are minted in the same millisecond (e.g. a recurring task's next instance
// spun off in the same tick as an unrelated add), which would corrupt every
// "by id" operation since two items would then share an id.
let idSeq=Date.now();
export function nextId():number { return ++idSeq; }
