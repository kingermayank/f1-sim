/**
 * Formula1 Wide draws its zero with a slash and has no plain alternate, so
 * "200" reads as "2ØØ". Numbers set in it draw each zero with the face's
 * letter O instead: the same shape without the slash. Screen readers still
 * get the digits.
 */
export function wideDigits(value: string | number): string {
  return String(value).replace(/0/g, 'O');
}

export function WideNumber({ value }: { value: string | number | null | undefined }) {
  if (value === null || value === undefined) return null;
  const text = String(value);
  if (!text.includes('0')) return <>{text}</>;
  return (
    <>
      <span aria-hidden="true">{wideDigits(text)}</span>
      <span className="visually-hidden">{text}</span>
    </>
  );
}
