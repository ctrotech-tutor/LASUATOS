/**
 * Plus Jakarta's full stop sits wide at display sizes and tight tracking;
 * this pulls each one in a touch (see `.tight-dot` in globals.css).
 */
export function Tight({ children }: Readonly<{ children: string }>) {
  const parts = children.split('.');
  return (
    <>
      {parts.map((part, index) => (
        <span key={index}>{part}{index < parts.length - 1 ? <span className="tight-dot">.</span> : null}</span>
      ))}
    </>
  );
}
