// Vite's ?raw import (a file's text), used by limits.rules.test.ts to read firestore.rules.
declare module "*?raw" {
  const text: string;
  export default text;
}
