"""Toneless broad IPA for pinyin and jyutping syllables, as ZIPA token sequences (one IPA symbol each)."""
PY_INI = [('zh', 'ʈʂ'), ('ch', 'ʈʂʰ'), ('sh', 'ʂ'), ('b', 'p'), ('p', 'pʰ'), ('m', 'm'), ('f', 'f'), ('d', 't'), ('t', 'tʰ'),
          ('n', 'n'), ('l', 'l'), ('g', 'k'), ('k', 'kʰ'), ('h', 'x'), ('j', 'tɕ'), ('q', 'tɕʰ'), ('x', 'ɕ'), ('r', 'ɻ'),
          ('z', 'ts'), ('c', 'tsʰ'), ('s', 's')]
PY_FIN = {'a': 'a', 'o': 'wo', 'e': 'ɤ', 'ai': 'ai', 'ei': 'ei', 'ao': 'au', 'ou': 'ou', 'an': 'an', 'en': 'ən', 'ang': 'aŋ',
          'eng': 'əŋ', 'ong': 'ʊŋ', 'er': 'əɻ', 'i': 'i', 'ia': 'ja', 'ie': 'jɛ', 'iao': 'jau', 'iu': 'jou', 'ian': 'jɛn',
          'in': 'in', 'iang': 'jaŋ', 'ing': 'iŋ', 'iong': 'jʊŋ', 'u': 'u', 'ua': 'wa', 'uo': 'wo', 'uai': 'wai', 'ui': 'wei',
          'uan': 'wan', 'un': 'wən', 'uang': 'waŋ', 'ueng': 'wəŋ', 'v': 'y', 've': 'ɥɛ', 'van': 'ɥɛn', 'vn': 'yn', 'ue': 'ɥɛ', 'n': 'n', 'ng': 'ŋ', 'm': 'm', 'uen': 'wən', 'uei': 'wei', 'iou': 'jou'}

def pinyin_ipa(s):
    s = s.lower().replace('ü', 'v')
    if not s.isalpha(): return ''
    ini = ''
    for p, v in PY_INI:
        if s.startswith(p) and len(s) > len(p): ini, s = v, s[len(p):]; break
    else:
        if s.startswith('y'):
            s = s[1:]; s = ('v' + s[1:]) if s.startswith('u') else (s if s.startswith('i') else 'i' + s)
        elif s.startswith('w'):
            s = s[1:]; s = s if s.startswith('u') else 'u' + s
    if ini in ('tɕ', 'tɕʰ', 'ɕ') and s.startswith('u'): s = 'v' + s[1:]
    if s == 'i' and ini in ('ʈʂ', 'ʈʂʰ', 'ʂ', 'ɻ', 'ts', 'tsʰ', 's'): return ini + 'ɨ'
    return ini + PY_FIN.get(s, s)

JP_INI = [('gw', 'kʷ'), ('kw', 'kʷʰ'), ('ng', 'ŋ'), ('b', 'p'), ('p', 'pʰ'), ('m', 'm'), ('f', 'f'), ('d', 't'), ('t', 'tʰ'),
          ('n', 'n'), ('l', 'l'), ('g', 'k'), ('k', 'kʰ'), ('h', 'h'), ('w', 'w'), ('z', 'ts'), ('c', 'tsʰ'), ('s', 's'), ('j', 'j')]
JP_NUC = [('aa', 'a'), ('oe', 'œ'), ('eo', 'ɵ'), ('yu', 'y'), ('a', 'ɐ'), ('e', 'ɛ'), ('i', 'i'), ('o', 'ɔ'), ('u', 'u')]
JP_SPECIAL = {'ing': 'ɪŋ', 'ik': 'ɪk', 'ung': 'ʊŋ', 'uk': 'ʊk', 'ei': 'ei', 'ou': 'ou', 'eoi': 'ɵy', 'm': 'm', 'ng': 'ŋ'}

def jyutping_ipa(s):
    s = s.lower()
    if not s.isalpha(): return ''
    if s in ('m', 'ng'): return JP_SPECIAL[s]
    ini = ''
    for p, v in JP_INI:
        if s.startswith(p) and len(s) > len(p): ini, s = v, s[len(p):]; break
    if ini == 'j' and s.startswith('yu'): ini = ''
    if s in JP_SPECIAL: return ini + JP_SPECIAL[s]
    for p, v in JP_NUC:
        if s.startswith(p):
            coda = s[len(p):]
            return ini + v + {'ng': 'ŋ', 'i': 'i', 'u': 'u', 'm': 'm', 'n': 'n', 'p': 'p', 't': 't', 'k': 'k', '': ''}.get(coda, coda)
    return ini + s

def to_tokens(ipa, vocab):
    return [vocab[ch] for ch in ipa if ch in vocab]

if __name__ == '__main__':
    for p in ['wo', 'ni', 'shi', 'zhong', 'xue', 'yuan', 'qu', 'er', 'yong', 'wen', 'ri', 'jiu']: print(p, pinyin_ipa(p))
    for j in ['ngo', 'nei', 'si', 'zung', 'hok', 'jyun', 'heoi', 'ji', 'jung', 'man', 'jat', 'gwong', 'm', 'oi', 'aa']: print(j, jyutping_ipa(j))
