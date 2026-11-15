# Notices for the private Mandarin g2pM prototype pack

g2pM 0.1.2.5 is Apache-2.0 (kakaobrain/g2pM). Its packaged `digest_cedict.pkl` is a
character-reading digest derived upstream from CC-CEDICT; the g2pM package distributes it
under its own Apache-2.0 licence. CC-CEDICT is CC BY-SA 4.0
(https://creativecommons.org/licenses/by-sa/4.0/). No redistribution.

phrase-pinyin-data v0.20.0 and pinyin-data v0.16.0 are MIT (mozillazg).
`large_pinyin.txt` composes cc_cedict, zdic_cibs, zdic_cybs, pinyin, di and overwrite data.
CC-CEDICT rows retain CC BY-SA 4.0 attribution; see the upstream README and LICENSE.

opencc-js 1.4.2 is MIT AND Apache-2.0. Its bundled dictionary data is generated from
opencc-data (Apache-2.0); both licence texts are included. Only `TSCharacters` rows with
single-code-point source and target are extracted.

This pack is private evaluation data. It is not committed or redistributed.

The portable segmenter uses jieba dictionary and HMM data from
`fengkx/jieba-rs@7f3b27375b638bc22a2efe2fd889ea60130d265c` (MIT).
The source attribution is jieba-rs; the corresponding source MIT licence is included as
`jieba-rs-LICENSE`. The shared pack manifest records the input and generated-file hashes.
