export interface NormalizedQuery {
  original: string;
  normalized: string;
  expandedTerms: string[];
}

export interface QueryAlias {
  alias: string;
  term?: string;
}

export interface NormalizeAndExpandQueryInput {
  query: string;
  aliases?: QueryAlias[];
}

const FULLWIDTH_TO_HALFWIDTH: Record<string, string> = buildFullwidthMap();

const TRADITIONAL_TO_SIMPLIFIED: Record<string, string> = {
  '繁': '简', '體': '体', '國': '国', '學': '学', '會': '会', '經': '经', '過': '过',
  '來': '来', '們': '们', '這': '这', '個': '个', '對': '对', '關': '关', '開': '开',
  '間': '间', '問': '问', '題': '题', '時': '时', '現': '现', '發': '发', '電': '电',
  '動': '动', '點': '点', '號': '号', '員': '员', '務': '务', '營': '营', '業': '业',
  '機': '机', '構': '构', '編': '编', '碼': '码', '訊': '讯', '設': '设', '備': '备',
  '內': '内', '見': '见', '書': '书', '寫': '写', '讀': '读', '記': '记', '錄': '录',
  '區': '区', '標': '标', '論': '论', '統': '统', '計': '计', '製': '制', '專': '专',
  '資': '资', '庫': '库', '檔': '档', '節': '节', '範': '范', '圍': '围', '權': '权',
  '認': '认', '證': '证', '驗': '验', '鑰': '钥', '鑑': '鉴', '別': '别', '類': '类',
  '規': '规', '則': '则', '條': '条', '狀': '状', '態': '态', '變': '变', '刪': '删',
  '匯': '汇', '總': '总', '結': '结', '報': '报', '導': '导', '選': '选', '擇': '择',
  '單': '单', '據': '据', '詢': '询', '檢': '检', '視': '视', '圖': '图', '網': '网',
  '頁': '页', '連': '连', '線': '线', '鏈': '链', '協': '协', '議': '议', '憑': '凭',
  '註': '注', '冊': '册', '帳': '账', '帶': '带', '載': '载', '還': '还', '環': '环',
  '場': '场', '廠': '厂', '廣': '广', '傳': '传', '遞': '递', '遠': '远', '週': '周',
  '鐘': '钟', '錶': '表', '蓋': '盖', '盤': '盘', '鍋': '锅', '爐': '炉', '燈': '灯',
  '話': '话', '車': '车', '紀': '纪', '歷': '历', '職': '职', '劃': '划', '項': '项',
  '籤': '签', '識': '识', '織': '织', '團': '团', '隊': '队', '覆': '复', '許': '许',
  '審': '审', '駁': '驳', '銷': '销', '廢': '废', '減': '减', '換': '换', '轉': '转',
  '獲': '获', '尋': '寻', '覓': '觅', '實': '实', '辦': '办', '處': '处', '調': '调',
  '復': '复', '補': '补', '護': '护', '養': '养', '維': '维', '儲': '储', '濾': '滤',
  '篩': '筛', '歸': '归', '納': '纳', '評': '评', '測': '测', '試': '试', '課': '课',
  '佈': '布', '閱': '阅', '級': '级', '終': '终', '於': '于', '後': '后', '與': '与',
  '並': '并', '從': '从', '為': '为', '將': '将', '給': '给', '雖': '虽', '運': '运',
  '行': '行', '讓': '让', '使': '使', '令': '令', '請': '请', '謝': '谢',
  '錢': '钱', '買': '买', '賣': '卖', '價': '价', '費': '费', '稅': '税',
  '門': '门', '窗': '窗', '牆': '墙', '頂': '顶', '底': '底', '邊': '边', '緣': '缘',
  '鐵': '铁', '鋼': '钢', '銀': '银', '銅': '铜', '金': '金', '木': '木', '水': '水',
  '火': '火', '土': '土', '石': '石', '磚': '砖', '瓦': '瓦', '玻': '玻', '璃': '璃',
  '塑': '塑', '膠': '胶', '紙': '纸', '布': '布', '棉': '棉', '麻': '麻', '絲': '丝',
  '綫': '线', '繩': '绳', '繫': '系', '綁': '绑', '扣': '扣',
  '鈕': '钮', '圈': '圈', '套': '套', '殼': '壳', '罩': '罩',
  '盒': '盒', '箱': '箱', '櫃': '柜', '架': '架', '桌': '桌', '椅': '椅', '床': '床',
  '光': '光', '亮': '亮', '暗': '暗', '明': '明', '滅': '灭', '熱': '热',
  '冷': '冷', '溫': '温', '涼': '凉', '寒': '寒', '暖': '暖', '冰': '冰', '凍': '冻',
  '溼': '湿', '乾': '干', '潮': '潮', '燥': '燥', '風': '风', '雨': '雨', '雪': '雪',
  '雲': '云', '霧': '雾', '雷': '雷', '晴': '晴', '陰': '阴',
  '春': '春', '夏': '夏', '秋': '秋', '冬': '冬', '年': '年', '月': '月', '日': '日',
  '分': '分', '秒': '秒', '期': '期', '歲': '岁', '齢': '龄',
};

export function normalizeAndExpandQuery(input: NormalizeAndExpandQueryInput): NormalizedQuery {
  const original = input.query ?? '';
  const normalized = normalizeQueryText(original);
  const expandedTerms = expandAliases(normalized, input.aliases ?? []);
  return { original, normalized, expandedTerms };
}

function normalizeQueryText(text: string): string {
  let result = '';
  for (const char of text) {
    if (FULLWIDTH_TO_HALFWIDTH[char]) {
      result += FULLWIDTH_TO_HALFWIDTH[char]!;
    } else if (TRADITIONAL_TO_SIMPLIFIED[char]) {
      result += TRADITIONAL_TO_SIMPLIFIED[char]!;
    } else {
      result += char;
    }
  }
  return result
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[，。！？、,.!?;:：；"'`~\s]+|[，。！？、,.!?;:：；"'`~\s]+$/g, '');
}

function expandAliases(normalizedQuery: string, aliases: QueryAlias[]): string[] {
  const expanded = new Set<string>();
  for (const alias of aliases) {
    const aliasText = normalizeQueryText(alias.alias ?? '');
    if (!aliasText) continue;
    if (normalizedQuery.includes(aliasText)) {
      const term = normalizeQueryText(alias.term ?? '');
      if (term && term !== aliasText) {
        expanded.add(term);
      }
    }
  }
  return Array.from(expanded);
}

function buildFullwidthMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (let code = 0xFF01; code <= 0xFF5E; code += 1) {
    const fullwidth = String.fromCharCode(code);
    const halfwidth = String.fromCharCode(code - 0xFEE0);
    map[fullwidth] = halfwidth;
  }
  map[String.fromCharCode(0x3000)] = ' ';
  return map;
}
