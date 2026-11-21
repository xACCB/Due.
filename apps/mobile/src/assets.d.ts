// Sound files bundled with the app: Metro turns an import into an asset id,
// which expo-audio plays (lib/doneSound.ts).
declare module "*.wav" {
  const asset: number;
  export default asset;
}
