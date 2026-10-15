// 生成 120 款模拟商品 SKU：6 品类 × 5 价格带 × 4 场景变体
// 运行: node scripts/generate-products.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.join(__dirname, '..', 'data')
const DATA_SOURCE = '模拟数据，仅供演示'

const BRANDS = ['青澜（模拟品牌）', '岚汐（模拟品牌）', '海屿（模拟品牌）', '听澜（模拟品牌）', '屿光（模拟品牌）']

const CATEGORIES = {
  冰箱: 'RF',
  洗衣机: 'WM',
  空调: 'AC',
  热水器: 'WH',
  电视: 'TV',
  洗碗机: 'DW'
}

const BANDS = {
  冰箱: [
    { label: '入门', min: 1300, max: 2200, energy: '三级', type: '单门冰箱', series: '轻鲜', w: 520, d: 600, h: 1500 },
    { label: '中端', min: 2600, max: 3800, energy: '二级', type: '双门冰箱', series: '鲜屿', w: 610, d: 650, h: 1600 },
    { label: '中高端', min: 4200, max: 5500, energy: '一级', type: '三门冰箱', series: '澄鲜', w: 700, d: 680, h: 1720 },
    { label: '高端', min: 6500, max: 8800, energy: '新一级', type: '对开门冰箱', series: '冰屿', w: 830, d: 700, h: 1780 },
    { label: '旗舰', min: 9900, max: 15000, energy: '新一级', type: '十字四门冰箱', series: '御鲜', w: 910, d: 730, h: 1900 }
  ],
  洗衣机: [
    { label: '入门', min: 999, max: 1800, energy: '三级', type: '波轮洗衣机', series: '简洗', w: 550, d: 580, h: 960 },
    { label: '中端', min: 2200, max: 3300, energy: '二级', type: '滚筒洗衣机', series: '净屿', w: 595, d: 560, h: 850 },
    { label: '中高端', min: 3800, max: 5000, energy: '一级', type: '变频滚筒洗衣机', series: '澄洗', w: 595, d: 575, h: 850 },
    { label: '高端', min: 5500, max: 7800, energy: '新一级', type: '洗烘一体洗衣机', series: '静洗', w: 600, d: 590, h: 855 },
    { label: '旗舰', min: 8900, max: 13000, energy: '新一级', type: '分区洗烘洗衣机', series: '御洗', w: 600, d: 600, h: 870 }
  ],
  空调: [
    { label: '入门', min: 1800, max: 2600, energy: '三级', type: '壁挂空调', series: '清风', w: 790, d: 190, h: 275 },
    { label: '中端', min: 2900, max: 4200, energy: '二级', type: '变频壁挂空调', series: '屿风', w: 820, d: 195, h: 285 },
    { label: '中高端', min: 4500, max: 6000, energy: '新一级', type: '新一级变频挂机', series: '澄风', w: 850, d: 200, h: 295 },
    { label: '高端', min: 6500, max: 8800, energy: '新一级', type: '立柜空调', series: '静宇', w: 420, d: 380, h: 1720 },
    { label: '旗舰', min: 9500, max: 14000, energy: '新一级', type: '新风立柜空调', series: '御宇', w: 440, d: 400, h: 1760 }
  ],
  热水器: [
    { label: '入门', min: 800, max: 1500, energy: '二级', type: '储水式电热水器', series: '暖屿', w: 460, d: 480, h: 760 },
    { label: '中端', min: 1700, max: 2600, energy: '一级', type: '储水式电热水器', series: '澄暖', w: 470, d: 490, h: 880 },
    { label: '中高端', min: 2900, max: 3900, energy: '一级', type: '速热式电热水器', series: '速暖', w: 480, d: 500, h: 960 },
    { label: '高端', min: 4300, max: 5800, energy: '二级', type: '燃气热水器', series: '恒澜', w: 380, d: 180, h: 580 },
    { label: '旗舰', min: 6500, max: 9800, energy: '新一级', type: '空气能热水器', series: '御暖', w: 700, d: 700, h: 1800 }
  ],
  电视: [
    { label: '入门', min: 1100, max: 2000, energy: '三级', type: '液晶电视', series: '悦屿', w: 980, d: 90, h: 580 },
    { label: '中端', min: 2300, max: 3500, energy: '二级', type: '4K液晶电视', series: '澄悦', w: 1130, d: 95, h: 660 },
    { label: '中高端', min: 3900, max: 5500, energy: '一级', type: '4K全面屏电视', series: '景屿', w: 1240, d: 80, h: 720 },
    { label: '高端', min: 6000, max: 8500, energy: '一级', type: '4K量子点电视', series: '澜景', w: 1450, d: 85, h: 840 },
    { label: '旗舰', min: 9500, max: 16000, energy: '一级', type: '8K MiniLED电视', series: '御景', w: 1900, d: 95, h: 1090 }
  ],
  洗碗机: [
    { label: '入门', min: 1800, max: 2800, energy: '二级', type: '台式洗碗机', series: '简净', w: 550, d: 500, h: 450 },
    { label: '中端', min: 3100, max: 4300, energy: '二级', type: '嵌入式洗碗机', series: '净屿', w: 598, d: 600, h: 760 },
    { label: '中高端', min: 4600, max: 6200, energy: '一级', type: '嵌入式洗碗机', series: '澄净', w: 598, d: 620, h: 775 },
    { label: '高端', min: 6800, max: 8800, energy: '新一级', type: '全嵌入式洗碗机', series: '隐净', w: 598, d: 620, h: 815 },
    { label: '旗舰', min: 9500, max: 14000, energy: '新一级', type: '独立嵌入式洗碗机', series: '御净', w: 605, d: 640, h: 820 }
  ]
}

const FAMILY_FIT = [
  [1, 2],
  [2, 3],
  [3, 4],
  [3, 6]
]

const POINTS = {
  冰箱: ['风冷无霜，免除手动除霜', '低噪运行，夜间安静不扰眠', '分区储存，食材不易串味', '变频压缩机，控温更均匀', '大容量设计，满足一周采购', '金属匀冷内胆，保鲜更持久'],
  洗衣机: ['多种洗涤程序，覆盖日常衣物', '高温除菌洗，贴身衣物更放心', '变频电机，运行平稳低噪', '中途添衣，灵活方便', '桶自清洁，减少二次污染', '上排水设计，适配多种户型'],
  空调: ['快速制冷，出风均匀', '自清洁蒸发器，减少维护', '低风量运行更安静', '宽电压启动，用电更安心', '智能温控，避免过冷过热', '易拆滤网，清洗方便'],
  热水器: ['多档水温调节', '防电墙安全设计', '速热模式，无需久等', '恒温出水，洗浴更舒适', '一级能效，保温省电', '大水量，满足连续洗浴'],
  电视: ['广色域画面，色彩通透', '低蓝光护眼模式', '远场语音，动口不动手', '运动补偿，观赛不拖影', '金属全面屏，颜值在线', '多接口，外接设备方便'],
  洗碗机: ['高温洗涤，油污更易溶解', '多种洗涤模式，灵活选择', '分层洗涤，少量餐具也省水', '烘存一体，餐具长效干爽', '低噪运行，开放厨房也友好', '软水系统，减少水垢残留']
}

const LIMITS = {
  冰箱: ['两侧需预留散热空间', '冷藏层较深，取后排食材需挪动', '门体较重，搬运安装需两人协作', '冷冻抽屉层数多，大件存放受限', '变频启动瞬间有轻微声响', '容量与占地需平衡，小厨房注意宽度'],
  洗衣机: ['脱水高速运转时有感噪音', '滚筒取衣需弯腰', '门封圈需定期清洁', '洗涤时间较波轮偏长', '烘干容量小于洗涤容量', '安装需预留下水与插座位置'],
  空调: ['制冷时室内偏干', '外机安装位置需提前确认', '低温制热效率下降', '柜机占用一定地面空间', '滤网需按季清洗', '运行时出风口附近风感明显'],
  热水器: ['储水式需预热后使用', '长期使用需检查镁棒', '燃气式安装要求通风良好', '冬季进水温度低时热水量略降', '体积较大，需预留安装空间', '水质较硬地区建议定期除垢'],
  电视: ['屏幕尺寸大，注意观看距离', '壁挂安装需承重墙', '系统广告可在设置中关闭', '深色画面偶有光晕', '接口位于背面，壁挂后插拔不便', '高分片源对带宽有一定要求'],
  洗碗机: ['重油污餐具建议预冲一下', '需使用专用洗碗盐与亮碟剂', '嵌入安装需橱柜预留位', '少量餐具洗涤略费时', '木质与部分塑料餐具需手洗', '排水管高度有安装要求']
}

const BAND_POINTS = {
  冰箱: ['入门之选，满足日常冷藏冷冻', '容量与占地更平衡', '风冷变频，保鲜与静音兼顾', '大容量多门，食材分类从容', '旗舰配置，深冷速冻与精细分区'],
  洗衣机: ['结构简单，皮实耐用', '洗净比提升，衣物更干净', '变频节能，噪音更低', '洗烘一体，阴雨天无忧', '上下分区，内外衣分开洗'],
  空调: ['基础制冷制热，安装便捷', '变频省电，温控更稳', '新一级能效，长期能耗更低', '大风量立柜，客厅快速降温', '新风换气，久待不闷'],
  热水器: ['小体积，适合小卫浴', '保温层加厚，更省电', '速热即洗，无需久等', '恒温燃烧，多点供水稳定', '空气能制热，能效领先'],
  电视: ['小尺寸卧室好选择', '主流尺寸，客厅适配', '全面屏观感，窄边框', '量子点高亮，白天也清晰', 'MiniLED分区控光，暗场细腻'],
  洗碗机: ['免安装改造，即插即用', '标准橱柜位嵌入', '一级水效，省水省电', '隐藏式面板，整体美观', '大容量分层，聚餐无压力']
}

const BAND_LIMITS = {
  冰箱: ['容量有限，适合一人食或辅助冷藏', '定频运行能耗略高', '门体与厨柜配色需提前确认', '宽幅较大，小厨房注意预留位', '价格较高，适合预算充足的家庭', '体积大，搬运入户前量好电梯与门宽'],
  洗衣机: ['容量较小，被褥类需分批', '无烘干功能', '结构相对简单，功能较少', '烘干能耗高于自然晾晒', '价格较高，适合预算充足的家庭', '安装需评估阳台或厨卫位置'],
  空调: ['低温制热能力一般', '能效一般，长开电费略高', '价格较高，适合预算充足的家庭', '柜机占地约0.2㎡', '外机位需与物业确认', '新风管道需提前布线'],
  热水器: ['容量有限，连续洗浴需等待', '加热速度一般', '价格较高，适合预算充足的家庭', '燃气安装需专业持证人员', '水箱大，对安装空间有要求', '冬季能耗高于夏季'],
  电视: ['亮场表现一般', '色域覆盖中等', '价格较高，适合预算充足的家庭', '65英寸以上注意观看距离', '壁挂需承重墙', '8K片源目前较少'],
  洗碗机: ['容量较小，锅具需手洗', '烘干效果一般', '价格较高，适合预算充足的家庭', '全嵌入需精确开孔尺寸', '首次使用需熟悉程序设置', '需预留进排水位']
}

function round100(v) {
  return Math.round(v / 100) * 100
}

function specFor(cat, band, j) {
  if (cat === '冰箱') {
    return {
      capacityL: 180 + band * 100 + j * 15,
      freezerCapacityL: 50 + band * 30 + j * 8,
      deepFreeze: band >= 3 || (band === 2 && j >= 2)
    }
  }
  if (cat === '洗衣机') {
    return {
      washCapacityKg: Math.round((5.5 + band * 1.6 + j * 0.5) * 10) / 10,
      spinSpeedRpm: 800 + band * 150 + j * 50
    }
  }
  if (cat === '空调') {
    const hp = [1, 1.25, 1.5, 2, 3][band] + (band >= 3 ? j * 0.25 : j * 0.25)
    const area = [
      [10, 15], [12, 18], [14, 20], [22, 32], [30, 45]
    ][band]
    return { horsepower: Math.round(hp * 100) / 100, suitableArea: [area[0], area[1]] }
  }
  if (cat === '热水器') {
    if (band === 3) return { literL: 13 + j, heatType: '燃气式' }
    if (band === 4) return { literL: 150 + j * 10, heatType: '空气能' }
    return { literL: 40 + band * 10 + j * 5, heatType: band === 2 ? '速热式电热' : '储水式电热' }
  }
  if (cat === '电视') {
    const inch = [43, 50, 55, 65, 75][band] + (band === 4 ? 10 : 0)
    const res = band === 0 ? '全高清' : band === 4 ? '8K超高清' : '4K超高清'
    return { inchSize: inch, resolution: res }
  }
  return {
    placeSets: [4, 8, 10, 13, 15][band] + j,
    dryType: ['余热烘干', '热风烘干', '热风烘干', '自动开门烘干', '晶蕾烘干'][band]
  }
}

function noiseFor(cat, band, j) {
  const bump = j % 2
  switch (cat) {
    case '冰箱': return { standard: 42 - band + bump, max: 44 + band }
    case '洗衣机': return { standard: 56 - band + bump, max: 74 - band }
    case '空调': return band <= 2 ? { standard: 22 + band - (j >= 2 ? 1 : 0) + bump, max: 52 + band } : { standard: 34 + band - 3 + bump, max: 55 + band }
    case '热水器': return { standard: 45 - band + bump, max: 52 + band }
    case '电视': return { standard: 30 - band + bump, max: 38 - band }
    case '洗碗机': return { standard: 52 - band * 2 + bump, max: 58 - band * 2 }
  }
}

function buildProducts() {
  const list = []
  for (const [cat, code] of Object.entries(CATEGORIES)) {
    const bands = BANDS[cat]
    for (let band = 0; band < bands.length; band++) {
      const b = bands[band]
      for (let j = 0; j < 4; j++) {
        const i = list.length
        const idxInCat = band * 4 + j
        const price = round100(b.min + (b.max - b.min) * (j * 0.22 + 0.05))
        const spec = specFor(cat, band, j)
        const noise = noiseFor(cat, band, j)
        const model = `${code}${String(idxInCat * 7 + (band + 1) * 3).padStart(3, '0')}`
        const name = `${BRANDS[i % BRANDS.length].replace('（模拟品牌）', '')} ${b.series}系列 ${b.type} ${model}`
        const energy = band === 0 && j === 0 ? '三级' : b.energy
        const familyFit = band === 4 && j === 3 ? [4, 6] : FAMILY_FIT[j]
        const tags = [b.type.replace(/洗衣机|空调|冰箱|热水器|电视|洗碗机/, ''), b.label]
        if (noise.standard <= 38) tags.push('静音')
        if (energy === '新一级') tags.push('节能')
        const suitableArea = spec.suitableArea
          ? [spec.suitableArea[0], spec.suitableArea[1]]
          : cat === '电视'
            ? [[10, 15], [12, 20], [15, 25], [20, 35], [28, 50]][band]
            : null
        const product = {
          id: `${code}-${String(idxInCat + 1).padStart(2, '0')}`,
          name,
          brand: BRANDS[i % BRANDS.length],
          category: cat,
          price,
          priceBand: b.label,
          energyGrade: energy,
          noiseDb: { standard: noise.standard, max: noise.max },
          dimensionsMm: {
            width: b.w + (j >= 2 ? 10 : 0),
            depth: b.d + (j >= 2 ? 10 : 0),
            height: b.h + (j >= 2 ? 15 : 0)
          },
          familySizeFit: [familyFit[0], familyFit[1]],
          suitableArea,
          rating: Math.round((4.2 + ((i * 7) % 8) / 10) * 10) / 10,
          stockStatus: ['有货', '有货', '库存紧张', '有货', '预售'][i % 5],
          afterSalesNote: [
            '整机保修1年，主要部件保修3年（模拟政策）',
            '整机保修2年，主要部件保修4年（模拟政策）',
            '整机保修3年，核心部件保修6年（模拟政策）',
            '整机保修3年，核心部件保修8年，支持上门检测（模拟政策）',
            '整机6年包修，核心部件10年，24小时上门（模拟政策）'
          ][band],
          tags,
          sellingPoints: [POINTS[cat][(i * 2) % 6], POINTS[cat][(i * 2 + 3) % 6], BAND_POINTS[cat][band]],
          limitations: [LIMITS[cat][i % 6], BAND_LIMITS[cat][band]],
          dataSource: DATA_SOURCE,
          ...specFor2(cat, spec)
        }
        list.push(product)
      }
    }
  }
  return list
}

// 品类专属字段平铺（区别于公共字段）
function specFor2(cat, spec) {
  if (cat === '冰箱') return { capacityL: spec.capacityL, freezerCapacityL: spec.freezerCapacityL, deepFreeze: spec.deepFreeze }
  if (cat === '洗衣机') return { washCapacityKg: spec.washCapacityKg, spinSpeedRpm: spec.spinSpeedRpm }
  if (cat === '空调') return { horsepower: spec.horsepower }
  if (cat === '热水器') return { literL: spec.literL, heatType: spec.heatType }
  if (cat === '电视') return { inchSize: spec.inchSize, resolution: spec.resolution }
  return { placeSets: spec.placeSets, dryType: spec.dryType }
}

const products = buildProducts()
mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(path.join(OUT_DIR, 'products.json'), JSON.stringify(products, null, 2), 'utf8')

const byCat = {}
for (const p of products) byCat[p.category] = (byCat[p.category] || 0) + 1
console.log(`[generate] products.json written: ${products.length} SKUs`)
console.log('[generate] by category:', JSON.stringify(byCat))
