import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pagesDir = path.join(root, "src/data/pages");
const base = JSON.parse(await readFile(path.join(pagesDir, "mashinist-avtovyshki.json"), "utf8"));
const site = JSON.parse(await readFile(path.join(root, "src/data/site.json"), "utf8"));
const planned = JSON.parse(await readFile(path.join(root, "src/data/planned-specialties.json"), "utf8"));

const pages = [
  {
    file: "preview-motorist-tsementirovochnogo-agregata.json",
    slug: "motorist-tsementirovochnogo-agregata",
    title: "Моторист цементировочного агрегата",
    h1: "Отбор мотористов цементировочного агрегата для объектов",
    seoTitle: "Отбор мотористов цементировочного агрегата | АБС",
    description: "Отбор мотористов цементировочного агрегата для нефтегазовых объектов по России. Учитываем тип ЦА, задачи, опыт, документы и график. Оставьте заявку.",
    heroLead: "Отбираем мотористов цементировочного агрегата для работы на нефтегазовых объектах. Согласуем тип оборудования, задачи, требования к опыту и документам, регион и график. Представляем специалистов под условия вашей заявки.",
    objectionsTitle: "Отбор под задачи вашего объекта",
    objectionsText: "Опыт работы на одном агрегате не означает готовность к любому оборудованию и условиям. До поиска уточняем, на каком ЦА предстоит работать и какие операции входят в обязанности сотрудника.",
    objections: [
      ["Нужен специалист на определённый агрегат", "Фиксируем модель ЦА и требуемый опыт. Сверяем эти условия с опытом кандидата.", "minecart-loaded.svg"],
      ["Важно подготовить выход к нужной дате", "Уточняем срок, регион, график и готовность к выезду. Условия выхода согласуем до представления специалиста.", "calendar-check.svg"],
      ["Нужны понятные сведения о кандидате", "Собираем информацию об опыте, документах и готовности к условиям заявки для вашего рассмотрения.", "file-earmark-check.svg"],
    ],
    checksTitle: "При отборе проверяем мотористов цементировочного агрегата",
    checksText: "Профиль моториста ЦА формируем по оборудованию и перечню работ. Требования к разряду, удостоверениям и дополнительным документам задаются условиями конкретной заявки.",
    checks: ["Тип и модель цементировочного агрегата.", "Опыт выполнения заявленных операций на сопоставимом оборудовании.", "Опыт подготовки агрегата к работе и его обслуживания в пределах обязанностей.", "Удостоверение по профессии и разряд, указанные в требованиях заказчика.", "Наличие водительских категорий, если в обязанности входит управление автомобилем.", "Количество специалистов и планируемая дата выхода.", "Регион, график и готовность к условиям объекта."],
    processTitle: "Процесс отбора моториста ЦА",
    process: [
      ["Получаем заявку", "Уточняем задачи, количество специалистов, регион, график и желаемую дату выхода."],
      ["Согласовываем профиль", "Фиксируем требования к опыту, оборудованию и документам до начала поиска."],
      ["Проводим первичный отбор", "Сверяем опыт кандидатов с заявкой и уточняем готовность к условиям объекта."],
      ["Представляем специалистов", "Передаём сведения о кандидатах для собеседования и решения заказчика."],
    ],
    resultText: "Передаём сведения о подходящих специалистах, чтобы вы могли оценить их опыт и обсудить задачи объекта на собеседовании.",
    resultItems: ["Описание опыта работы на цементировочных агрегатах.", "Сведения об удостоверениях, разряде и других документах из профиля кандидата.", "Информацию о готовности к региону, графику и дате выхода.", "Контактные данные для финального общения."],
    resultNote: "Финальное собеседование и решение по специалисту остаются на стороне заказчика.",
    formText: "Укажите модель ЦА, задачи, количество мотористов, регион, график и желаемую дату выхода. Требования к опыту, разряду и документам добавьте в комментарий.",
    teamText: "Менеджер уточняет требования, организует первичный отбор и поддерживает связь с вашей командой. Если условия заявки меняются, согласовывает обновлённый профиль до продолжения поиска.",
    tasksTitle: "Для каких задач нужен моторист ЦА",
    tasksIntro: "Перечень работ фиксируем в заявке. Поиск ведём по опыту, который нужен для конкретных операций и оборудования.",
    tasks: [
      ["Цементирование скважин", "Учитываем опыт работы на агрегате при выполнении заявленных операций по цементированию.", "tools.svg"],
      ["Подготовка оборудования", "Уточняем опыт подготовки ЦА к работе и проверки его узлов в пределах обязанностей моториста.", "gear.svg"],
      ["Обслуживание агрегата", "Сверяем опыт обслуживания и устранения неисправностей с перечнем работ заказчика.", "tools.svg"],
      ["Работа на удалённых объектах", "Заранее обсуждаем регион, график, условия размещения и готовность к выезду.", "geo-alt.svg"],
    ],
    faq: [
      ["Какой моторист цементировочного агрегата нужен для нашего объекта?", "Начинаем с модели ЦА и перечня операций. Затем согласуем опыт, документы, график и срок выхода. Так в заявке появляется профиль специалиста, с которым можно сравнивать кандидатов."],
      ["Можно ли указать конкретную модель агрегата?", "Да. Укажите модель и особенности работ в заявке. Если важен опыт именно на этом оборудовании, зафиксируем его как отдельное требование к специалисту."],
      ["Какой разряд и какие документы нужны мотористу?", "Требования согласуем по заявке и задачам объекта. Укажите необходимый разряд, удостоверение по профессии и дополнительные документы. Если сотрудник должен управлять автомобилем, отдельно уточним водительские категории."],
      ["Можно ли заказать несколько мотористов на вахту?", "Да. Укажите количество специалистов, распределение по агрегатам, график и даты выхода. До поиска также уточним условия размещения и готовность к выезду на объект."],
      ["В какие сроки можно представить специалистов?", "Срок зависит от оборудования, требований к опыту и документам, региона и готовности кандидатов. Обсудим ориентир после получения заявки; дату выхода согласуем отдельно."],
    ],
    images: ["operator-category-hero.png", "excavator-specialist-checks.png", "excavator-specialist-process.png", "excavator-specialist-tasks.png"],
    imageAlts: ["Специалисты и техника на строительном объекте", "Специалист и руководитель сверяют документы перед сменой", "Руководитель объекта и специалист обсуждают план работ", "Техника выполняет работы на строительном объекте"],
  },
  {
    file: "preview-slesar-po-remontu-dst.json",
    slug: "slesar-po-remontu-dst",
    title: "Слесарь по ремонту ДСТ",
    h1: "Отбор слесарей по ремонту ДСТ для объектов",
    seoTitle: "Отбор слесарей по ремонту ДСТ для объектов | АБС",
    description: "Отбор слесарей по ремонту ДСТ для объектов по России. Учитываем дорожно-строительную технику, узлы, виды ремонта, опыт и график. Оставьте заявку.",
    heroLead: "Отбираем слесарей по ремонту дорожно-строительной техники для объектов и ремонтных баз. Учитываем состав машин, узлы, характер работ, опыт специалиста, регион и график. Представляем кандидатов под условия вашей заявки.",
    objectionsTitle: "Специалист под вашу технику и перечень работ",
    objectionsText: "ДСТ — дорожно-строительная техника. Требования к слесарю зависят от машин в парке и работ, которые ему предстоит выполнять. До поиска уточняем эти условия, чтобы опыт кандидата соответствовал задаче.",
    objections: [
      ["Нужен опыт с определёнными машинами", "Фиксируем типы и модели техники. Уточняем, с какими машинами и узлами работал кандидат.", "minecart-loaded.svg"],
      ["Нужно усилить ремонтную команду", "Согласуем перечень работ, количество специалистов, место работы и желаемую дату выхода.", "people.svg"],
      ["Объект находится далеко от ремонтной базы", "Уточняем формат работы, условия на площадке, график и готовность специалиста к выезду.", "geo-alt.svg"],
    ],
    checksTitle: "Что проверяем при отборе слесаря по ремонту ДСТ",
    checksText: "Сверяем опыт с составом парка и задачами ремонтной службы. Требования к самостоятельности, разряду и документам фиксируем до начала поиска.",
    checks: ["Типы и модели дорожно-строительной техники.", "Узлы и системы, с которыми работал специалист.", "Опыт диагностики, разборки, ремонта и сборки по задачам заявки.", "Опыт технического обслуживания и регламентных работ.", "Требуемый разряд, профессиональные документы и дополнительные условия допуска.", "Количество специалистов, место работы и дата выхода.", "Регион, график и готовность к условиям площадки."],
    processTitle: "Как проходит отбор слесаря по ремонту ДСТ",
    process: [
      ["Получаем заявку", "Уточняем задачи, количество специалистов, регион, график и желаемую дату выхода."],
      ["Согласовываем профиль", "Фиксируем требования к опыту, оборудованию и документам до начала поиска."],
      ["Проводим первичный отбор", "Сверяем опыт кандидатов с заявкой и уточняем готовность к условиям объекта."],
      ["Представляем специалистов", "Передаём сведения о кандидатах для собеседования и решения заказчика."],
    ],
    resultText: "Передаём информацию о специалистах для предметного разговора с руководителем ремонтной службы и финального собеседования.",
    resultItems: ["Описание опыта по дорожно-строительной технике и видам ремонта.", "Сведения о профессиональных документах и квалификации из профиля кандидата.", "Информацию о готовности к региону, графику и дате выхода.", "Контактные данные для финального общения."],
    resultNote: "Решение по кандидату и оценка его соответствия задачам остаются на стороне заказчика.",
    formText: "Укажите технику, узлы и виды работ, количество слесарей, место работы, график и желаемую дату выхода. Требования к опыту и документам добавьте в комментарий.",
    teamText: "Менеджер уточняет профиль специалиста и условия выхода, организует первичный отбор и поддерживает связь с вашей командой. При изменении состава работ согласует новые требования.",
    tasksTitle: "Для каких работ отбираем слесарей ДСТ",
    tasksIntro: "При поиске учитываем задачи ремонтной службы и условия, в которых специалист будет работать.",
    tasks: [
      ["Техническое обслуживание", "Уточняем опыт регламентных работ на технике, указанной в заявке.", "gear.svg"],
      ["Диагностика неисправностей", "Учитываем узлы и системы, с которыми предстоит работать, и требуемую самостоятельность специалиста.", "tools.svg"],
      ["Ремонт и сборка узлов", "Сверяем опыт разборки, восстановления, замены деталей и сборки с перечнем работ.", "building-gear.svg"],
      ["Работа на базе или объекте", "Уточняем оснащение рабочего места, формат выездов, регион и график.", "geo-alt.svg"],
    ],
    faq: [
      ["Что означает ДСТ?", "В контексте этой страницы ДСТ — дорожно-строительная техника. Для отбора слесаря важно уточнить типы и модели машин, узлы и характер работ, а не ограничиваться общим названием профессии."],
      ["Можно ли указать конкретные марки и модели техники?", "Да. Перечислите машины и узлы, опыт с которыми обязателен. Если в парке разные типы техники, согласуем приоритеты и профиль для каждой позиции."],
      ["Вы отбираете слесарей только для работы на ремонтной базе?", "Рассматриваем заявки для ремонтных баз и объектов. До поиска уточняем рабочее место, оснащение, формат выездов, график и условия размещения, если они предусмотрены задачей."],
      ["Можно ли заказать несколько слесарей с разной специализацией?", "Да. Укажите количество сотрудников и распределение задач. Для каждой позиции отдельно зафиксируем технику, узлы, опыт, документы и срок выхода."],
      ["В какие сроки можно согласовать выход слесаря?", "Срок зависит от техники, характера работ, требований к опыту и условий объекта. После получения заявки обсудим ориентир, а готовность специалиста и дату выхода согласуем отдельно."],
    ],
    images: ["bulldozer-specialist-hero.png", "bulldozer-specialist-checks.png", "bulldozer-specialist-process.png", "bulldozer-specialist-tasks.png"],
    imageAlts: ["Дорожно-строительная техника на объекте", "Специалист и руководитель проверяют готовность к работе", "Специалист и руководитель обсуждают задачу на объекте", "Дорожно-строительная техника работает на площадке"],
  },
];

const iconForCheck = ["minecart-loaded.svg", "gear.svg", "tools.svg", "file-earmark-check.svg", "person-workspace.svg", "calendar-check.svg", "geo-alt.svg"];
const iconForTask = ["tools.svg", "minecart-loaded.svg", "building.svg", "geo-alt.svg"];

pages.push(JSON.parse(await readFile(path.join(root, "seo-research/slesar-am/content.json"), "utf8")));

for (const item of pages) {
  const page = structuredClone(base);
  page.output = `_prototype/${item.slug}/index.html`;
  page.path = `/_prototype/${item.slug}/`;
  page.status = "draft";
  page.schema = [];
  page.seo = { title: item.seoTitle, description: item.description, robots: "noindex, nofollow", canonical: "", openGraph: false };
  page.eyebrow = "Предпросмотр — шаблон 3";
  page.h1 = item.h1;
  page.navigationLabel = item.title;
  page.breadcrumbs = [
    { label: "Главная", href: "/" },
    item.slug.startsWith("slesar-")
      ? { label: "Слесари", href: "/slesari/" }
      : { label: "Машинисты спецтехники", href: "/mashinisty-spetstehniki/" },
    { label: item.title, href: "" },
  ];
  page.specialist.heroImage = `/assets/images/${item.images[0]}`;
  page.specialist.heroAlt = item.imageAlts[0];
  page.specialist.heroLead = item.heroLead;
  page.specialist.metricsTitle = item.objectionsTitle;
  page.specialist.metricsText = "";
  page.specialist.objectionsText = item.objectionsText;
  page.specialist.objections = item.objections.map(([title, solution, icon]) => ({ title, solution, icon }));
  page.specialist.resultMetrics = [];
  page.specialist.teamStats = [];
  page.specialist.checksTitle = item.checksTitle;
  page.specialist.checksText = item.checksText;
  page.specialist.checksImage = `/assets/images/${item.images[1]}`;
  page.specialist.checksImageAlt = item.imageAlts[1];
  page.specialist.checks = item.checks.map((label, i) => ({ label, icon: iconForCheck[i] }));
  page.specialist.processTitle = item.processTitle;
  page.specialist.processImage = `/assets/images/${item.images[2]}`;
  page.specialist.processImageAlt = item.imageAlts[2];
  page.specialist.process = item.process.map(([title, text]) => ({ title, text }));
  page.specialist.resultTitle = "Что получает заказчик";
  page.specialist.resultText = item.resultText;
  page.specialist.resultItems = item.resultItems.map((label) => ({ label }));
  page.specialist.resultNote = item.resultNote;
  page.specialist.formTitle = "Оставьте заявку";
  page.specialist.formText = item.formText;
  page.specialist.teamTitle = "Заявку ведёт персональный менеджер";
  page.specialist.teamText = item.teamText;
  page.specialist.tasksTitle = item.tasksTitle;
  page.specialist.tasksIntro = item.tasksIntro;
  page.specialist.tasksImage = `/assets/images/${item.images[3]}`;
  page.specialist.tasksImageAlt = item.imageAlts[3];
  page.specialist.tasks = item.tasks.map(([title, text, icon], i) => ({ title, text, icon: icon || iconForTask[i] }));
  page.faq = item.faq.map(([question, answer]) => ({ question, answer }));
  for (const prefix of ["hero", "checks", "process", "tasks"]) {
    const file = await readFile(path.join(root, "src", page.specialist[`${prefix}Image`].slice(1)));
    if (file.subarray(1, 4).toString() === "PNG") {
      const dimensionPrefix = prefix === "hero" ? prefix : `${prefix}Image`;
      page.specialist[`${dimensionPrefix}Width`] = file.readUInt32BE(16);
      page.specialist[`${dimensionPrefix}Height`] = file.readUInt32BE(20);
    }
  }
  const entry = planned.pages.find((entry) => entry.slug === item.slug);
  if (!entry) throw new Error(`Missing assigned URL for ${item.slug}`);
  page.links = [{label: item.slug.startsWith("slesar-") ? "Слесари спецтехники" : "Машинисты спецтехники", href: entry.parent}];
  if (item.slug.startsWith("slesar-")) {
    const specialty = item.slug.endsWith("-dst") ? "слесаря по ремонту ДСТ" : "слесаря по ремонту автомобилей";
    page.specialist.processTitle = `Процесс отбора ${specialty}`;
  }
  await writeFile(path.join(pagesDir, item.file), `${JSON.stringify(page, null, 2)}\n`, "utf8");
  const published = structuredClone(page);
  const canonical = new URL(entry.path, site.domain).href;
  published.path = entry.path;
  published.output = `${entry.path.slice(1)}index.html`;
  published.status = "ready";
  published.eyebrow = "";
  published.seo = {...page.seo, robots: "index, follow", canonical, openGraph: true};
  published.schema = [{
    "@context": "https://schema.org", "@type": "Service", "@id": `${canonical}#service`,
    name: item.seoTitle.replace(/\s*\|\s*АБС$/u, ""), url: canonical,
    areaServed: {"@type":"Country",name:"Россия"},
    provider: {"@id": `${site.domain}#organization`},
  }];
  await writeFile(path.join(pagesDir, `${item.slug}.json`), `${JSON.stringify(published, null, 2)}\n`, "utf8");
}

process.stdout.write(`Created ${pages.length} noindex draft pages in the specialist template.\n`);
