// plantPhotoCaption.ts - the caption under a species' photo, which is the photo of one of its
// plants: "From plant NIAH-PLT-00012". Internal ids ("plant:<uuid>", used before a physical
// tag is attached) are never shown, the same rule as displayTag on the web portal.
// Plain TypeScript with no imports, so Node can test it (plantPhotoCaption.test.mjs).

export function plantPhotoCaption(tag: string | null | undefined): string {
  const value = String(tag ?? '').trim();
  if (value === '' || /^plant:/i.test(value)) return 'From a plant without a tag';
  return `From plant ${value}`;
}
