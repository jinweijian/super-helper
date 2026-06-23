const ANSWER_BEARING_PATTERNS = [
  /(当|如果|若|在).{2,40}(时|情况|条件下|之后)/,
  /步骤[一二三四五六七八九十0-9]+/,
  /[一二三四五六七八九十0-9]+[.、]/,
  /(支持|不支持|会|不会|需要|必须|返回|提示|提醒|开通|关闭|开启|启用)/,
  /(包含|包括).{0,40}(任务|时长|时间|内容|状态|字段)/,
  /(可以通过|可通过|可以|能).{0,30}(查看|操作|设置|管理|发送|搜索|学习|提醒|添加|删除|修改)/,
  /学员|教师|管理员|用户|订单|课程|班级|任务|学习|计划/,
];

export function selectAnswerSpan(input: {
  text: string;
  matchedTerms?: string[];
}): string | undefined {
  const terms = (input.matchedTerms ?? [])
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term.length >= 2);
  const sentences = input.text
    .split(/\n/)
    .filter((line) => !/^\s*#{1,6}\s+/.test(line))
    .flatMap((line) => line.split(/[。；;]/))
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .filter((sentence) => ANSWER_BEARING_PATTERNS.some((pattern) => pattern.test(sentence)));
  if (sentences.length === 0) {
    return undefined;
  }
  return sentences
    .map((sentence) => ({
      sentence,
      matches: terms.filter((term) => sentence.toLowerCase().includes(term)).length,
    }))
    .sort((left, right) => right.matches - left.matches || left.sentence.length - right.sentence.length)[0]
    ?.sentence.slice(0, 500);
}
