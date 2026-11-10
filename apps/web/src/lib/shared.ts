export function normalizePhone(value: string): string {
  let p = value.trim().replace(/[\s().-]/g, "");
  if (p.startsWith("00")) p = "+" + p.slice(2);
  if (/^0\d{9}$/.test(p)) p = "+233" + p.slice(1);
  if (/^[1-9]\d{7,14}$/.test(p)) p = "+" + p;
  if (!/^\+[1-9]\d{7,14}$/.test(p))
    throw new Error(
      "Enter a valid phone number with country code. Ghana numbers may start with 0.",
    );
  return p;
}
const gsm = new Set(
  Array.from(
    "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
  ),
);
const extended = new Set(Array.from("^{}\\[~]|€\f"));
export function smsParts(text: string) {
  let units = 0;
  let unicode = false;
  for (const c of text) {
    if (gsm.has(c)) units++;
    else if (extended.has(c)) units += 2;
    else unicode = true;
  }
  if (unicode) units = text.length;
  return {
    encoding: unicode ? "Unicode" : "GSM-7",
    characters: units,
    parts: Math.max(
      1,
      Math.ceil(
        units /
          (units <= (unicode ? 70 : 160)
            ? unicode
              ? 70
              : 160
            : unicode
              ? 67
              : 153),
      ),
    ),
  };
}
export const number = (n: number) => new Intl.NumberFormat("en-GH").format(n);
