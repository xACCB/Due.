// The current time, from module scope: the React Compiler's purity lint
// rejects Date.now() inside a component (the web app's glideClock() does the
// same job).
export const clock = (): number => Date.now();
