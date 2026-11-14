// Strings for outline-model.js. Keys are camelCase; keep en and zh-TW in step (tests/web/strings.test.js).
const islands = (n) => (n === 1 ? "island" : "islands");
const landmarks = (n) => (n === 1 ? "landmark" : "landmarks");
/** English counts its nouns: "1 of 1 landmark lit", "2 of 3 landmarks lit". */
const litOf = ({ lit, total }) => `${lit} of ${total} ${landmarks(total)} lit`;

export default {
  en: {
    summary: ({ charted, total, lit }) => `${charted} of ${total} ${islands(total)} charted · ${lit} lit`,
    summaryMentor: ({ islands: n, total, explored }) => `${n} of ${total} ${islands(total)} explored · ${explored} ${landmarks(explored)}`,
    // a row's tooltip: what its dot and count mean, after the whole name when the row cuts it
    rowNamed: "{name} · {what}",
    rowOpen: "Open water",
    rowLit: (v) => `Open water · ${litOf(v)}`,
    rowSandbar: (v) => `Sandbar · ${litOf(v)}`,
    rowSettled: (v) => `Settled · ${litOf(v)}`,
    rowMountainous: (v) => `Mountainous · ${litOf(v)}`,
    rowReef: (v) => `Reef · ${litOf(v)}`,
    rowUnexplored: "Not yet explored",
    rowExplored: ({ explored, total }) => `${explored} of ${total} ${landmarks(total)} explored`,
  },
  "zh-TW": {
    summary: "已測繪{charted}/{total}座島嶼・點亮{lit}個地標",
    summaryMentor: "已探索{islands}/{total}座島嶼・{explored}個地標",
    rowNamed: "{name}・{what}",
    rowOpen: "未知水域",
    rowLit: "未知水域・已點亮{lit}/{total}個地標",
    rowSandbar: "沙洲・已點亮{lit}/{total}個地標",
    rowSettled: "穩固・已點亮{lit}/{total}個地標",
    rowMountainous: "高山・已點亮{lit}/{total}個地標",
    rowReef: "暗礁・已點亮{lit}/{total}個地標",
    rowUnexplored: "尚未探索",
    rowExplored: "已探索{explored}/{total}個地標",
  },
};
