export function SplashScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div
        className="flex min-h-24 min-w-52 items-center justify-center"
        aria-label="Lincei Studio splash screen"
      >
        <span
          className="text-xl font-medium text-foreground"
          style={{ fontFamily: 'Baskerville, Palatino, Georgia, "Times New Roman", serif' }}
        >
          Lincei Studio
        </span>
      </div>
    </div>
  );
}
