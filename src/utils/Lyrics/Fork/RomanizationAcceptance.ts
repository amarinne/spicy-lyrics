const regexMatches = (regex: RegExp, text: string): boolean => {
  regex.lastIndex = 0;
  return regex.test(text);
};

export function acceptRomanization(
  source: string,
  romanized: string,
  scriptRegexes: readonly RegExp[]
): boolean {
  return !scriptRegexes.some((regex) =>
    regexMatches(regex, source) && regexMatches(regex, romanized)
  );
}
