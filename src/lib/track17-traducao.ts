// ─────────────────────────────────────────────────────────────────────────────
// Tradução dos eventos de rastreio para português.
//
// Por que existe: registramos no 17TRACK com `lang: "pt"` e eles até devolvem
// um campo `description_translation`, mas com o texto ORIGINAL quando o
// provedor chinês não tem tradução. Medido num evento real da China Post:
//
//   "description": "物流订单已创建"
//   "description_translation": { "lang": "pt", "description": "物流订单已创建" }
//
// Ou seja: sem isto aqui, o cliente brasileiro lê chinês na página da loja —
// que é exatamente o problema que o rastreio próprio veio resolver.
//
// Regra de ouro: na dúvida, NÃO inventa. Um evento traduzido errado —
// "entregue" no lugar de "devolvido" — gera reclamação e perda de confiança.
// Por isso frase chinesa que a tabela não conhece vira um texto NEUTRO
// ("Atualização da transportadora"), que é verdade sempre, e vai para o log
// para entrar na tabela depois. Chinês nunca chega ao comprador.
// ─────────────────────────────────────────────────────────────────────────────

/** O que aparece quando o evento está em chinês e a tabela não o conhece. */
export const EVENTO_SEM_TRADUCAO = "Atualização da transportadora";

/** Tem ideograma CJK? É o sinal de que o provedor não traduziu. */
export function temCJK(texto: string): boolean {
  return /[㐀-鿿豈-﫿]/.test(texto);
}

/**
 * Regras em ORDEM: a primeira que casar vence, então as mais específicas vêm
 * antes. São trechos, não frases inteiras, porque o provedor cola cidade e
 * número no meio do texto ("到达【广州】处理中心").
 */
const REGRAS: Array<[RegExp, string]> = [
  // ── Entrega ───────────────────────────────────────────────────────────────
  //
  // PRIMEIRO de tudo, e o FRACASSO antes do sucesso, de propósito:
  // "未妥投" (não entregue) CONTÉM "妥投" (entregue), e "无人签收" contém
  // "签收". Na ordem inversa, uma entrega falha apareceria para o cliente como
  // "Entregue" — o erro mais caro que esta tela pode cometer. E o bloco vem
  // antes do trânsito porque as regras de trânsito abaixo são amplas
  // ("到达" = chegou) e não podem engolir um evento de entrega.
  [/未妥投|投递失败|派送失败|无人签收|投递未成功/, "Tentativa de entrega sem sucesso"],
  [/收件人不在/, "Destinatário ausente"],
  [/地址错误|地址不详|地址不全|地址有误/, "Problema no endereço de entrega"],
  [/退回|退件|退货/, "Devolvido ao remetente"],
  [/重新派送|再次派送|二次投递/, "Nova tentativa de entrega"],
  // "出门投递【BR Dispatching【São P】" (o carteiro saiu com o objeto) — texto
  // real, o mais comum dos sem tradução em 30/10/2026: 141 cidades, e o
  // cliente lia "Atualização da transportadora" bem no dia da entrega.
  [/派送中|正在派送|开始派送|投递中|安排投递|出门投递/, "Saiu para entrega"],
  [/已签收|妥投|投递成功/, "Entregue"],
  [/待取件|自提/, "Disponível para retirada"],

  // ── Criação / coleta ──────────────────────────────────────────────────────
  [/物流订单已创建|运单已创建|已下单/, "Pedido de envio criado"],
  // "离开收寄点" (saiu da agência de postagem) contém 收寄, que é coleta logo
  // abaixo: vem antes, senão a saída viraria "Coletado".
  [/离开收寄点|离开收寄局/, "Saiu da unidade de postagem"],
  // "中国邮政已收取邮件" (a China Post coletou o objeto) — texto real, que a
  // regra antiga não pegava porque só conhecia 收件, e este é 收取.
  // Restrito a "邮政已收取"/"已收取邮件": "收件人已收取" (o DESTINATÁRIO
  // retirou) também contém 收取, e virar "coletado" ali seria mentir.
  [/已揽收|已揽件|已收件|揽收成功|邮政已收取|已收取邮件|邮件已接收|已收寄|收寄成功/, "Coletado pela transportadora"],
  [/等待揽收|待揽收/, "Aguardando coleta"],
  // "承运商接收" (a transportadora internacional recebeu o pacote) — texto real.
  [/承运商接收|承运商已接收|已交运|交运成功/, "Recebido pela transportadora"],
  [/仓库已收货|已入库|到达仓库/, "Recebido no armazém"],

  // ── Alfândega ─────────────────────────────────────────────────────────────
  // CONCLUÍDO antes de "em andamento": "出口清关完成" (exportação liberada,
  // texto real) chegava junto de "Customs Clearance Completed" e caía na regra
  // inglesa de "customs clearance", aparecendo como "Em desembaraço" — o
  // contrário do que aconteceu.
  [/出口清关完成|出口.*放行|已放行出口/, "Liberado pela alfândega de exportação"],
  [/进口清关完成|进口.*放行|已放行进口/, "Liberado pela alfândega de importação"],
  [/清关完成|已清关|海关放行/, "Liberado pela alfândega"],
  [/海关扣留|扣关|海关扣押/, "Retido pela alfândega"],
  [/关税已缴|税费已缴|已缴税|已缴纳关税/, "Impostos pagos"],
  // Só as formas de "a pagar": "关税" sozinho também está em "关税已缴"
  // (imposto já pago), e "aguardando pagamento" ali seria mentira.
  [/待缴税|待缴纳|需缴税|待付税|等待缴税/, "Aguardando pagamento de impostos"],
  [/清关中|正在清关|进口清关|出口清关|目的国清关/, "Em desembaraço aduaneiro"],
  [/待清关|等待清关/, "Aguardando desembaraço aduaneiro"],
  [/海关查验/, "Em inspeção aduaneira"],

  // ── Trânsito: os específicos antes dos genéricos ─────────────────────────
  // "航班到达" (voo chegou) contém "到达" (chegou): se a regra genérica viesse
  // primeiro, todo pouso viraria "chegou ao centro de distribuição".
  [/航班延误/, "Voo atrasado"],
  [/航班起飞|已起飞/, "Voo decolou"],
  [/航班到达|已降落/, "Voo chegou ao destino"],
  [/已交航空公司|交航空|已上飞机/, "Entregue à companhia aérea"],
  // "邮件到达处理中心【BR Arriyal at Processin】" — texto real: é a chegada ao
  // centro de tratamento NO BRASIL, informação que o genérico "chegou ao
  // centro de distribuição" jogaria fora.
  [/巴西|到达.*【\s*BR\b/, "Chegou ao centro de tratamento no Brasil"],
  [/到达寄达地|到达寄达国|寄达国|到达目的国|目的国到达/, "Chegou ao país de destino"],
  [/移交末端|交付末端|交给当地|已交.*当地|转交.*派送/, "Entregue à transportadora local"],
  [/到达派送站|到达投递局|到达投递站|到达营业部/, "Chegou à unidade de entrega"],
  // "启运" (início do transporte, texto real) — mesma ideia do despacho.
  [/启运|已发出|已发货|已出库|已封发|封发/, "Encomenda despachada"],
  // "该国内转运中" (em trânsito DENTRO do país de destino) — texto real. Vem
  // antes do "转运中" genérico, que perderia a informação do país.
  [/该国内转运|国内转运中/, "Em trânsito no país de destino"],
  // "干线中转" (transferência na linha principal, entre países) — texto real.
  [/干线中转|干线运输/, "Em trânsito internacional"],
  [/包裹异常|物流异常|运输异常/, "Ocorrência no transporte"],
  // Amplos de propósito: a China Post escreve "邮件离开【长沙】" e
  // "邮件到达【广州】", sem a palavra "处理中心" que a regra antiga exigia.
  [/离开/, "Saiu do centro de distribuição"],
  [/到达|抵达/, "Chegou ao centro de distribuição"],
  [/运输中|途中|转运中|中转|发往/, "Em trânsito"],

  // ── Inglês: o mesmo evento muda de idioma no meio do trajeto ──────────────
  [/^shipping information received|^info received|label created/i, "Pedido de envio criado"],
  [/received by carrier/i, "Recebido pela transportadora"],
  [/picked up|collected by/i, "Coletado pela transportadora"],
  [/departed from|left the/i, "Saiu do centro de distribuição"],
  [/arrived at/i, "Chegou ao centro de distribuição"],
  [/in transit|forwarded/i, "Em trânsito"],
  // Concluído antes de "em andamento" (ver o bloco chinês da alfândega).
  [/clearance completed|clearance complete|released from customs|customs released/i, "Liberado pela alfândega"],
  [/customs clearance|customs processing/i, "Em desembaraço aduaneiro"],
  // Mesma inversão do bloco chinês: "not delivered" contém "delivered".
  [/not delivered|undelivered|delivery attempt|failed attempt|unsuccessful/i, "Tentativa de entrega sem sucesso"],
  [/returned to sender|return to sender/i, "Devolvido ao remetente"],
  [/out for delivery/i, "Saiu para entrega"],
  [/delivered/i, "Entregue"],
];

/**
 * Descrição do evento em português.
 *
 * Texto já em português passa direto (nenhuma regra casa). Chinês que a
 * tabela não conhece vira EVENTO_SEM_TRADUCAO e sai no log, para a tabela
 * crescer com base no que aparece de verdade — não no que eu imagino que
 * apareça.
 */
export function traduzirEvento(texto: string | null | undefined): string {
  const t = String(texto ?? "").trim();
  if (!t) return "";
  for (const [padrao, traducao] of REGRAS) {
    if (padrao.test(t)) return traducao;
  }
  if (temCJK(t)) {
    console.warn("[rastreio] evento sem tradução:", t);
    return EVENTO_SEM_TRADUCAO;
  }
  return t;
}

// ── Locais ───────────────────────────────────────────────────────────────────
//
// A China Post informa o local em ideogramas ("长沙市" = Changsha). As
// cidades por onde passa encomenda de e-commerce chinês são poucas e se
// repetem — polos logísticos e as capitais —, então uma tabela cobre quase
// tudo. Cidade antes de província: "广东省广州市" deve virar Guangzhou, não
// só Guangdong.

const CIDADES: Array<[string, string]> = [
  ["广州", "Guangzhou"], ["深圳", "Shenzhen"], ["东莞", "Dongguan"], ["佛山", "Foshan"],
  ["中山", "Zhongshan"], ["惠州", "Huizhou"], ["汕头", "Shantou"], ["珠海", "Zhuhai"],
  ["义乌", "Yiwu"], ["金华", "Jinhua"], ["杭州", "Hangzhou"], ["宁波", "Ningbo"],
  ["温州", "Wenzhou"], ["台州", "Taizhou"], ["上海", "Xangai"], ["北京", "Pequim"],
  ["天津", "Tianjin"], ["长沙", "Changsha"], ["武汉", "Wuhan"], ["郑州", "Zhengzhou"],
  ["成都", "Chengdu"], ["重庆", "Chongqing"], ["西安", "Xi'an"], ["南京", "Nanquim"],
  ["苏州", "Suzhou"], ["无锡", "Wuxi"], ["合肥", "Hefei"], ["南昌", "Nanchang"],
  ["厦门", "Xiamen"], ["福州", "Fuzhou"], ["泉州", "Quanzhou"], ["莆田", "Putian"],
  ["青岛", "Qingdao"], ["济南", "Jinan"], ["临沂", "Linyi"], ["石家庄", "Shijiazhuang"],
  ["沈阳", "Shenyang"], ["大连", "Dalian"], ["哈尔滨", "Harbin"], ["长春", "Changchun"],
  ["太原", "Taiyuan"], ["南宁", "Nanning"], ["昆明", "Kunming"], ["贵阳", "Guiyang"],
  ["兰州", "Lanzhou"], ["乌鲁木齐", "Urumqi"], ["香港", "Hong Kong"], ["澳门", "Macau"],
];

const PROVINCIAS: Array<[string, string]> = [
  ["广东", "Guangdong"], ["浙江", "Zhejiang"], ["江苏", "Jiangsu"], ["福建", "Fujian"],
  ["湖南", "Hunan"], ["湖北", "Hubei"], ["河南", "Henan"], ["河北", "Hebei"],
  ["山东", "Shandong"], ["山西", "Shanxi"], ["四川", "Sichuan"], ["安徽", "Anhui"],
  ["江西", "Jiangxi"], ["广西", "Guangxi"], ["云南", "Yunnan"], ["贵州", "Guizhou"],
  ["辽宁", "Liaoning"], ["吉林", "Jilin"], ["黑龙江", "Heilongjiang"], ["陕西", "Shaanxi"],
];

// A etapa brasileira chega com o EVENTO em inglês colado no local:
// "In Transit【São Paulo】", "Departure from Processing Center【Betim】",
// "Arrival at【BR】". Só os colchetes saíam, e o cliente lia "In Transit São
// Paulo". O evento já está na descrição: do local fica só o lugar.
// ("Arriyal" com y é como vem mesmo.)
const PREFIXO_LOCAL = /^(?:arri[vy]al at(?: processing center)?|departure from(?: processing center)?|in transit|dispatching|delivered|out for delivery)\s*/i;

// Nome latino de polo chinês ("GuangDong") vira o mesmo nome da tabela, com o
// país, como o local em ideogramas. As três que a tabela escreve em português
// entram pelo pinyin.
const PINYIN_ALIAS: Record<string, string> = { shanghai: "Xangai", beijing: "Pequim", nanjing: "Nanquim" };
const chavePolo = (s: string) => s.replace(/\s+/g, "").toLowerCase();
const POLO_LATINO = new Map<string, string>([
  ...CIDADES.map(([, nome]) => [chavePolo(nome), nome] as [string, string]),
  ...PROVINCIAS.map(([, nome]) => [chavePolo(nome), nome] as [string, string]),
  ...Object.entries(PINYIN_ALIAS),
]);

/**
 * Local do evento em português.
 *
 * Texto latino ("SAO PAULO") passa como está, sem o prefixo em inglês. Ideograma
 * que não está na tabela vira "China" — menos preciso, mas verdadeiro, e muito
 * melhor que mostrar caracteres que o comprador não consegue ler. Esse caso sai
 * no log, para a tabela crescer com o que aparece de fato.
 */
export function traduzirLocal(local: string | null | undefined): string | null {
  const t = String(local ?? "").trim().replace(PREFIXO_LOCAL, "").replace(/[【】\[\]]/g, "").trim();
  if (!t) return null;
  if (!temCJK(t)) {
    if (/^BR$/i.test(t)) return "Brasil";
    const polo = POLO_LATINO.get(chavePolo(t));
    return polo ? `${polo}, China` : t;
  }
  const cidade = CIDADES.find(([zh]) => t.includes(zh));
  if (cidade) return `${cidade[1]}, China`;
  const provincia = PROVINCIAS.find(([zh]) => t.includes(zh));
  if (provincia) return `${provincia[1]}, China`;
  console.warn("[rastreio] local sem tradução:", t);
  return "China";
}

/**
 * O provedor corta o local em 50 caracteres, e o corte leva o "】" do fim:
 * "Departure from Processing Center【São José dos Cam".
 */
function localCortado(bruto: string | null | undefined): boolean {
  const b = String(bruto ?? "");
  return b.includes("【") && !b.includes("】");
}

/**
 * Locais de TODOS os eventos de uma remessa, traduzidos e na mesma ordem.
 *
 * Existe por causa do corte acima: a mesma cidade costuma vir inteira em
 * outro evento da remessa ("Dispatching【São José dos Campos】"), e é dele
 * que o nome é completado. Sem um inteiro que comece igual, o local some:
 * nenhum local é melhor que meia cidade, e a descrição do evento continua.
 */
export function traduzirLocais(locais: Array<string | null | undefined>): Array<string | null> {
  const traduzidos = locais.map(traduzirLocal);
  const inteiros = traduzidos.filter((t, i): t is string => !!t && !localCortado(locais[i]));
  return traduzidos.map((t, i) => {
    if (!t || !localCortado(locais[i])) return t;
    return inteiros.find((inteiro) => inteiro.startsWith(t)) ?? null;
  });
}
