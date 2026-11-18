/** Portable citation formatting. It never selects a reading or changes its tone. */
export function formatPinyin(value: string, notation: "diacritics" | "tone-numbers" | "unmarked" = "diacritics"): string {
  return value.toLowerCase().replace(/u:|v/gu, "ü").replace(/([a-züê]+)([0-5])/gu, (_, letters: string, digit: string) => {
    if (notation === "tone-numbers") return `${letters}${digit === "5" ? "0" : digit}`;
    const tone = Number(digit);
    if (notation === "unmarked" || tone === 0 || tone === 5) return letters;
    const position = letters.includes("a") ? letters.indexOf("a") : letters.includes("e") ? letters.indexOf("e")
      : letters.includes("ou") ? letters.indexOf("o") : Math.max(...Array.from(letters, (letter, index) => /[iouüê]/u.test(letter) ? index : -1));
    const target = position < 0 ? Math.max(letters.indexOf("m"), letters.indexOf("n")) : position;
    if (target < 0) return letters;
    return `${letters.slice(0, target + 1)}${["", "̄", "́", "̌", "̀"][tone]}${letters.slice(target + 1)}`.normalize("NFC");
  });
}
