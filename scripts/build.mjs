import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptPath), "..");
const src = path.join(root, "src");
const dist = path.join(root, "dist");

const readText = (relativePath) => readFile(path.join(src, relativePath), "utf8");
const readJson = async (relativePath) => JSON.parse(await readText(relativePath));

const escapeHtml = (value = "") => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const renderTokens = (template, values) => template.replace(/{{([A-Za-z0-9]+)}}/g, (_, key) => {
  if (!(key in values)) throw new Error(`Missing template token: ${key}`);
  return values[key];
});

const renderNavigation = (items, footer = false, readyRoutes = new Set()) => items.map((item) => {
  const className = footer ? "" : ' class="nav-link"';
  const isAnchor = item.href.startsWith("/#") || readyRoutes.has(item.href);
  const itemHtml = isAnchor
    ? `<a${className} href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>`
    : `<span${className} aria-disabled="true">${escapeHtml(item.label)}</span>`;
  return `<li class="nav-item">${itemHtml}</li>`;
}).join("\n");

const renderHeaderNavigation = (items, readyRoutes) => items.map((item, index) => {
  if (!item.children?.length) {
    const isAnchor = item.href.startsWith("/#") || readyRoutes.has(item.href);
    const itemHtml = isAnchor
      ? `<a class="nav-link" href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>`
      : `<span class="nav-link" aria-disabled="true">${escapeHtml(item.label)}</span>`;
    return `<li class="nav-item">${itemHtml}</li>`;
  }

  const id = `header-dropdown-${index + 1}`;
  const children = item.children.map((child, childIndex) => {
    const overviewClass = childIndex === 0 ? " header-dropdown__overview" : "";
    return `<li><a class="dropdown-item${overviewClass}" href="${escapeHtml(child.href)}">${escapeHtml(child.label)}</a></li>`;
  }).join("\n");

  return `<li class="nav-item dropdown header-dropdown">
    <button class="nav-link dropdown-toggle" id="${id}" type="button" data-bs-toggle="dropdown" aria-expanded="false">${escapeHtml(item.label)}</button>
    <ul class="dropdown-menu header-dropdown__menu" aria-labelledby="${id}">${children}</ul>
  </li>`;
}).join("\n");

const navigationGroupForPath = (pagePath) => {
  if (pagePath.startsWith("/voditel-spetstehnika/")) return "drivers";
  if (pagePath.startsWith("/mashinisty-spetstehniki/")) return "operators";
  return "";
};

const navigationLabelForPage = (page) => page.navigationLabel || page.h1.replace(/^Подбор\s+/iu, "");

const buildHeaderNavigation = (items, homePage, pages, readyRoutes) => items.map((item) => {
  if (!item.group) return item;

  const homeGroup = homePage.specialistGroups.find((group) => group.title === item.homeGroup);
  const children = [
    { label: item.categoryLabel, href: item.href },
    ...(homeGroup?.items || []).map(({ title, href }) => ({ label: title, href })),
  ].filter((child) => readyRoutes.has(child.href));

  for (const page of pages) {
    const group = page.navigationGroup || navigationGroupForPath(page.path);
    if (group !== item.group || page.path.startsWith("/_prototype/") || page.status !== "ready") continue;

    const entry = { label: navigationLabelForPage(page), href: page.path };
    const existingIndex = children.findIndex((child) => child.href === entry.href);
    if (existingIndex === -1) children.push(entry);
    else children[existingIndex] = entry;
  }

  return { ...item, children };
});

const renderBreadcrumbs = async (items) => {
  if (!items.length) return "";
  const template = await readText("components/breadcrumbs.html");
  const list = items.map((item, index) => {
    const isLast = index === items.length - 1;
    if (isLast || !item.href) {
      return `<li class="breadcrumb-item active" aria-current="page">${escapeHtml(item.label)}</li>`;
    }
    return `<li class="breadcrumb-item"><a href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a></li>`;
  }).join("\n");
  return renderTokens(template, { items: list });
};

const renderCards = async (cards, readyRoutes) => {
  const template = await readText("components/card.html");
  const html = cards.map((card) => {
    const description = card.description
      ? `<p>${escapeHtml(card.description)}</p>`
      : "<!-- TODO: Insert the approved card description. -->";
    const link = card.href && readyRoutes.has(card.href)
      ? `<a class="stretched-link" href="${escapeHtml(card.href)}"><span class="visually-hidden">${escapeHtml(card.title)}</span></a>`
      : "";
    return `<div class="${escapeHtml(card.columnClass || "col-12 col-md-6 col-xl-4")}">${renderTokens(template, {
      icon: escapeHtml(card.icon),
      title: escapeHtml(card.title),
      description,
      link,
    })}</div>`;
  }).join("\n");
  return `<div class="row g-4">${html}</div>`;
};

const renderContactChannels = (items = []) => items.map((item) => {
  const isMax = item.icon === "max.svg";
  const icon = item.icon === "max.svg"
    ? `<img src="/assets/icons/max.svg" width="54" height="18" alt="MAX" />`
    : `<img src="/assets/icons/${escapeHtml(item.icon)}" width="22" height="22" alt="" aria-hidden="true" />`;
  const action = item.href
    ? `<a class="contacts-channel__link" href="${escapeHtml(item.href)}">${escapeHtml(item.value)}</a>`
    : `<span class="contacts-channel__value">${escapeHtml(item.value)}</span>`;
  return `<li class="col-12 col-md-4"><article class="contacts-channel h-100"><span class="contacts-channel__icon${isMax ? " contacts-channel__icon--max" : ""}">${icon}</span><p class="contacts-channel__label">${escapeHtml(item.label)}</p>${action}<p class="contacts-channel__note mb-0">${escapeHtml(item.note || "")}</p></article></li>`;
}).join("\n");

const renderContactChecklist = (items = []) => items.map((item) => `<li class="col-12"><article class="contacts-checklist__item"><span class="contacts-checklist__index">${escapeHtml(item.number)}</span><div><p class="contacts-checklist__title">${escapeHtml(item.title)}</p><p class="mb-0">${escapeHtml(item.text)}</p></div></article></li>`).join("\n");

const renderSpecialistCards = async (groups, readyRoutes) => {
  if (!groups?.length) return "";
  const template = await readText("components/specialist-card.html");
  return groups.map((group, groupIndex) => {
    const groupId = `specialist-group-${groupIndex + 1}`;
    const cards = group.items.map((item) => `<div class="${escapeHtml(group.columnClass || "col-12 col-sm-6 col-xl-3")}">${renderTokens(template, {
      description: escapeHtml(item.description || ""),
      icon: escapeHtml(item.icon),
      link: readyRoutes.has(item.href)
        ? `<a class="stretched-link" href="${escapeHtml(item.href)}"><span class="visually-hidden">${escapeHtml(item.title)}</span></a>`
        : "",
      title: escapeHtml(item.title),
    })}</div>`).join("\n");
    return `<section class="specialist-group" aria-labelledby="${groupId}">
      <h3 class="specialist-group__title mb-3" id="${groupId}">${escapeHtml(group.title)}</h3>
      <div class="row g-3">${cards}</div>
    </section>`;
  }).join("\n");
};

const renderCta = async (cta) => {
  if (!cta?.title) return "";
  const template = await readText("components/cta.html");
  return renderTokens(template, {
    title: escapeHtml(cta.title),
    text: cta.text ? `<p class="lead mb-0">${escapeHtml(cta.text)}</p>` : "",
    label: escapeHtml(cta.label),
    href: escapeHtml(cta.href),
  });
};

const renderFaq = async (faq, pageType) => {
  const itemTemplate = await readText("components/faq-item.html");
  const parentId = `faq-${pageType.replace(/[^a-z0-9-]/gi, "-")}`;
  const items = faq.map((item, index) => {
    const id = `${parentId}-${index + 1}`;
    return renderTokens(itemTemplate, {
      collapsed: index === 0 ? "" : "collapsed",
      expanded: index === 0 ? "true" : "false",
      id,
      parentId,
      question: escapeHtml(item.question),
      answer: item.answer ? escapeHtml(item.answer) : "<!-- TODO: Insert the approved FAQ answer. -->",
      show: index === 0 ? "show" : "",
    });
  }).join("\n");
  return `<div class="accordion" id="${parentId}">${items}</div>`;
};

const renderListItems = (items = [], className = "") => items.map((item) => `<li${className ? ` class="${className}"` : ""}>${escapeHtml(item)}</li>`).join("\n");

const renderCategoryRequirements = (items = []) => items.map((item) => {
  const label = typeof item === "string" ? item : item.label;
  const icon = typeof item === "string" ? "clipboard-check.svg" : item.icon;
  return `<li class="col"><div class="driver-category-requirements__tile h-100"><span class="driver-category-requirements__icon"><img src="/assets/icons/${escapeHtml(icon)}" width="22" height="22" alt="" aria-hidden="true" /></span><span>${escapeHtml(label)}</span></div></li>`;
}).join("\n");

const renderCategoryChecks = (items = []) => items.map((item) => `<li class="col-12 d-flex"><div class="driver-category-checks__tile h-100 w-100"><img src="/assets/icons/check-circle-fill.svg" width="20" height="20" alt="" aria-hidden="true" /><span>${escapeHtml(item)}</span></div></li>`).join("\n");

const renderAboutPrinciples = (items = []) => items.map((item) => `<li class="col-12 col-md-6 col-xl-4"><article class="about-principle h-100"><span class="about-principle__icon"><img src="/assets/icons/${escapeHtml(item.icon)}" width="24" height="24" alt="" aria-hidden="true" /></span><h3>${escapeHtml(item.title)}</h3><p class="mb-0">${escapeHtml(item.text)}</p></article></li>`).join("\n");

const renderAboutSteps = (items = []) => items.map((item, index) => `<li class="col"><article class="about-step"><span class="about-step__number">${String(index + 1).padStart(2, "0")}</span><div><h3>${escapeHtml(item.title)}</h3><p class="mb-0">${escapeHtml(item.text)}</p></div></article></li>`).join("\n");

const renderAboutOutcomes = (items = []) => items.map((item) => `<li><img src="/assets/icons/check-circle-fill.svg" width="20" height="20" alt="" aria-hidden="true" /><span>${escapeHtml(item)}</span></li>`).join("\n");

const renderSpecialistTasks = (items = []) => items.map((item) => `<div class="col-12 col-md-6"><article class="specialist-task-card h-100"><span class="specialist-task-card__icon"><img src="/assets/icons/${escapeHtml(item.icon)}" width="25" height="25" alt="" aria-hidden="true" /></span><h3>${escapeHtml(item.title)}</h3><p class="mb-0">${escapeHtml(item.text)}</p></article></div>`).join("\n");

const renderSpecialistChecks = (items = []) => items.map((item) => {
  const label = typeof item === "string" ? item : item.label;
  const icon = typeof item === "string" ? "check-circle-fill.svg" : item.icon;
  return `<li class="col-12 d-flex"><div class="specialist-checks__item w-100 h-100"><span class="specialist-checks__icon"><img src="/assets/icons/${escapeHtml(icon)}" width="20" height="20" alt="" aria-hidden="true" /></span><span>${escapeHtml(label)}</span></div></li>`;
}).join("\n");

const renderSpecialistResultItems = (items = []) => items.map((item, index) => {
  const label = typeof item === "string" ? item : item.label;
  const image = typeof item === "string" ? "" : item.image;
  const visual = image ? `<figure class="specialist-deliverable__visual mb-0"><img src="/assets/images/${escapeHtml(image)}" width="64" height="64" alt="" aria-hidden="true" loading="lazy" /></figure>` : `<img class="specialist-deliverable__fallback" src="/assets/icons/check-circle-fill.svg" width="18" height="18" alt="" aria-hidden="true" />`;
  const alignmentClass = index === 0 ? " specialist-deliverable__item--visual-top" : "";
  return `<li class="col d-flex"><article class="specialist-deliverable__item${alignmentClass} w-100 h-100">${visual}<span>${escapeHtml(label)}</span></article></li>`;
}).join("\n");

const renderSpecialistMetricsPanel = (specialist = {}) => {
  if (!(specialist.resultMetrics || []).length) return "";
  const items = specialist.resultMetrics.map((item, index) => {
    return `<li class="col-6 col-lg"><div class="specialist-metrics__step"><span class="specialist-metrics__index">${index + 1}</span><span class="specialist-metrics__value">${escapeHtml(item.value)}</span><span class="specialist-metrics__label">${escapeHtml(item.label)}</span></div></li>`;
  }).join("\n");
  const lead = specialist.metricsText ? `<p class="specialist-metrics__lead">${escapeHtml(specialist.metricsText)}</p>` : "";
  return `<div class="specialist-objections__metrics">${lead}<div class="specialist-metrics__timeline-wrap"><ol class="row g-0 list-unstyled mb-0 specialist-metrics__timeline">${items}</ol><span class="specialist-metrics__complete"><img src="/assets/icons/check-lg.svg" width="18" height="18" alt="" aria-hidden="true" /></span></div></div>`;
};

const renderSpecialistTeam = (specialist = {}) => {
  if (!specialist.teamTitle) return "";
  const stats = (specialist.teamStats || []).map((item) => `<li class="col-12 col-md-6"><article class="specialist-team__stat h-100"><span class="specialist-team__stat-value">${escapeHtml(item.value)}</span><p class="mb-0">${escapeHtml(item.label)}</p></article></li>`).join("\n");
  return `<section class="specialist-team" aria-labelledby="specialist-team-title"><div class="container"><div class="specialist-team__shell"><div class="row g-4 g-lg-5 align-items-center"><div class="col-12 col-lg-4"><div class="specialist-team__lead"><span class="specialist-team__eyebrow">Команда подбора</span><h2 id="specialist-team-title">${escapeHtml(specialist.teamTitle)}</h2><p class="mb-0">${escapeHtml(specialist.teamText || "")}</p></div></div><div class="col-12 col-lg-8"><ul class="row g-3 mx-0 list-unstyled mb-0">${stats}</ul></div></div></div></div></section>`;
};

const renderSpecialistObjections = (specialist = {}) => {
  if (!specialist.metricsTitle) return "";
  const cards = (specialist.objections || []).map((item) => `<li class="col-12 col-md-6"><article class="specialist-objections__card h-100"><div class="row g-3 w-100"><div class="col-auto"><span class="specialist-objections__icon"><img src="/assets/icons/${escapeHtml(item.icon)}" width="24" height="24" alt="" aria-hidden="true" /></span></div><div class="col"><div class="row g-3"><div class="col-12 col-sm-5"><h3>${escapeHtml(item.title)}</h3></div><div class="col-12 col-sm-7"><p class="specialist-objections__solution mb-0">${escapeHtml(item.solution)}</p></div></div></div></div></article></li>`).join("\n");
  return `<section class="section-space specialist-objections" aria-labelledby="specialist-objections-title"><div class="container"><div class="row"><div class="col-12 col-lg-8"><h2 id="specialist-objections-title">${escapeHtml(specialist.metricsTitle)}</h2><p class="specialist-objections__intro">${escapeHtml(specialist.objectionsText || "")}</p></div></div><ul class="row g-4 list-unstyled mb-0">${cards}<li class="col-12">${renderSpecialistMetricsPanel(specialist)}</li></ul></div></section>`;
};

const renderSpecialistProcess = (items = []) => items.map((item, index) => `<li class="col"><article class="specialist-process-card h-100"><span class="specialist-process-card__number">0${index + 1}</span><h3>${escapeHtml(item.title)}</h3><p class="mb-0">${escapeHtml(item.text)}</p></article></li>`).join("\n");

const renderProcessSteps = (items = []) => items.map((item, index) => `<li class="col">
  <article class="driver-process-card h-100">
    <span class="driver-process-card__number">0${index + 1}</span>
    <h3>${escapeHtml(item.title)}</h3>
    <p class="mb-0">${escapeHtml(item.text)}</p>
  </article>
</li>`).join("\n");

const renderCategoryForm = (form, title) => {
  if (!form) return "";
  const safeTitle = escapeHtml(title || "Оставьте заявку на подбор водителей");
  return `<section class="request-section section-space" id="request" aria-labelledby="request-title">
  <div class="container"><div class="row justify-content-center"><div class="col-12 col-xl-10">
    <div class="request-shell"><div class="row justify-content-center"><div class="col-12 col-lg-10">
      <h2 id="request-title" class="mb-4 text-center">${safeTitle}</h2>
      <div data-request-popup-source>${form}</div>
    </div></div></div>
  </div></div></div>
</section>
<div class="modal fade request-form-modal" id="requestFormModal" tabindex="-1" aria-labelledby="requestFormModalTitle" aria-hidden="true" data-request-popup>
  <div class="modal-dialog modal-dialog-centered modal-lg">
    <div class="modal-content request-shell p-0">
      <div class="modal-header border-0 px-4 pt-4 pb-0">
        <h2 class="h3 mb-0" id="requestFormModalTitle">${safeTitle}</h2>
        <button class="btn-close" type="button" data-bs-dismiss="modal" aria-label="Закрыть форму"></button>
      </div>
      <div class="modal-body px-4 pb-4 pt-3" data-request-popup-form></div>
    </div>
  </div>
</div>`;
};

const renderForm = async (page, region, { idSuffix = "", includeValidationModal = true } = {}) => {
  const template = await readText("components/form.html");
  let form = renderTokens(template, {
    source: escapeHtml(page.seo.title),
    sourceUrl: escapeHtml(page.path),
    pageType: escapeHtml(page.pageType),
    city: escapeHtml(region.city),
    regionSlug: escapeHtml(region.region_slug),
  });

  if (!includeValidationModal) {
    form = form.replace(/\n<div class="modal fade request-validation-modal"[\s\S]*$/, "");
  }

  if (idSuffix) {
    ["company-site", "request-name", "request-phone", "request-region", "request-comment", "request-consent"].forEach((id) => {
      form = form.replaceAll(id, `${id}-${idSuffix}`);
    });
  }

  return form;
};

const renderHeader = async (site, readyRoutes) => renderTokens(await readText("components/header.html"), {
  contactsLink: readyRoutes.has("/kontakty/")
    ? '<a class="header-topline__contact" href="/kontakty/">Контакты</a>'
    : '<span class="header-topline__contact" aria-disabled="true">Контакты</span>',
  email: escapeHtml(site.email),
  homeHref: "/",
  logo: escapeHtml(site.logo),
  navigation: renderHeaderNavigation(site.navigation, readyRoutes),
  phone: escapeHtml(site.phone),
  phoneHref: escapeHtml(site.phoneHref),
});

const renderFooter = async (site, readyRoutes) => renderTokens(await readText("components/footer.html"), {
  email: escapeHtml(site.email),
  logo: escapeHtml(site.logo),
  navigation: renderNavigation(site.navigation, true, readyRoutes),
  phone: escapeHtml(site.phone),
  phoneHref: escapeHtml(site.phoneHref),
  year: String(new Date().getFullYear()),
});

const isTechnicalPage = (page) => page.path === "/404.html"
  || page.path === "/request/"
  || page.path === "/thanks/"
  || page.path.startsWith("/_prototype/");

const robotsFor = (page) => isTechnicalPage(page) || page.status !== "ready"
  ? "noindex, nofollow"
  : "index, follow";

const isIndexable = (page) => robotsFor(page) === "index, follow";

const getPageVisual = (page) => {
  if (page.template === "home") {
    return {
      src: "/assets/images/hero-construction-specialist.png",
      width: 1915,
      height: 821,
      alt: "Специалист на строительном объекте",
    };
  }

  const section = page.template === "category" ? page.category
    : page.template === "specialist" ? page.specialist
      : page.template === "contacts" ? page.contacts
        : page.template === "about" ? page.about
          : null;
  if (!section?.heroImage) return null;

  return {
    src: section.heroImage,
    width: section.heroWidth || 1915,
    height: section.heroHeight || 821,
    alt: section.heroAlt || page.h1,
  };
};

const createAutoSchema = (page, site) => {
  if (!isIndexable(page)) return null;

  const pageUrl = page.seo.canonical || new URL(page.path, site.domain).href;
  const organizationId = `${site.domain}#organization`;
  const websiteId = `${site.domain}#website`;
  const breadcrumbId = `${pageUrl}#breadcrumb`;
  const breadcrumbs = page.breadcrumbs?.length
    ? page.breadcrumbs
    : [{ label: "Главная", href: "/" }];
  const pageSchemas = (page.schema || []).map(({ "@context": _context, ...schema }) => schema);
  const graph = [
    {
      "@type": "Organization",
      "@id": organizationId,
      name: site.brand,
      url: site.domain,
      email: site.email,
      telephone: site.phone,
    },
    {
      "@type": "WebSite",
      "@id": websiteId,
      name: site.brand,
      url: site.domain,
      publisher: { "@id": organizationId },
    },
    ...pageSchemas,
    {
      "@type": "WebPage",
      "@id": `${pageUrl}#webpage`,
      name: page.h1,
      url: pageUrl,
      description: page.seo.description,
      isPartOf: { "@id": websiteId },
      breadcrumb: { "@id": breadcrumbId },
    },
    {
      "@type": "BreadcrumbList",
      "@id": breadcrumbId,
      itemListElement: breadcrumbs.map((item, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: item.label,
        item: item.href ? new URL(item.href, site.domain).href : pageUrl,
      })),
    },
  ];

  if (page.faq?.length) {
    graph.push({
      "@type": "FAQPage",
      "@id": `${pageUrl}#faq`,
      mainEntity: page.faq.map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: { "@type": "Answer", text: item.answer },
      })),
    });
  }

  return { "@context": "https://schema.org", "@graph": graph };
};

const renderSitemap = (pages) => {
  const urls = pages
    .filter(isIndexable)
    .map((page) => `  <url><loc>${escapeHtml(page.seo.canonical)}</loc></url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
};

const renderHeadExtras = (page, site) => {
  const canonical = page.seo.canonical
    ? `<link rel="canonical" href="${escapeHtml(page.seo.canonical)}" />`
    : "";
  const visual = getPageVisual(page);
  const imageUrl = visual ? new URL(visual.src, site.domain).href : "";
  const imageType = visual?.src.endsWith(".png") ? "image/png" : "image/jpeg";
  const openGraph = isIndexable(page)
    ? [
      '<meta property="og:type" content="website" />',
      `<meta property="og:site_name" content="${escapeHtml(site.brand)}" />`,
      '<meta property="og:locale" content="ru_RU" />',
      `<meta property="og:title" content="${escapeHtml(page.seo.title)}" />`,
      `<meta property="og:description" content="${escapeHtml(page.seo.description)}" />`,
      `<meta property="og:url" content="${escapeHtml(new URL(page.path, site.domain).href)}" />`,
      visual ? `<meta property="og:image" content="${escapeHtml(imageUrl)}" />` : "",
      visual ? `<meta property="og:image:secure_url" content="${escapeHtml(imageUrl)}" />` : "",
      visual ? `<meta property="og:image:type" content="${imageType}" />` : "",
      visual ? `<meta property="og:image:width" content="${visual.width}" />` : "",
      visual ? `<meta property="og:image:height" content="${visual.height}" />` : "",
      visual ? `<meta property="og:image:alt" content="${escapeHtml(visual.alt)}" />` : "",
      '<meta name="twitter:card" content="summary_large_image" />',
      `<meta name="twitter:title" content="${escapeHtml(page.seo.title)}" />`,
      `<meta name="twitter:description" content="${escapeHtml(page.seo.description)}" />`,
      visual ? `<meta name="twitter:image" content="${escapeHtml(imageUrl)}" />` : "",
      visual ? `<meta name="twitter:image:alt" content="${escapeHtml(visual.alt)}" />` : "",
    ].filter(Boolean).join("\n")
    : "";
  const schemaData = createAutoSchema(page, site);
  const schema = schemaData
    ? `<script type="application/ld+json">${JSON.stringify(schemaData).replaceAll("<", "\\u003c")}</script>`
    : "";
  return { canonical, openGraph, schema };
};

const validatePageModel = (page) => {
  const required = ["output", "path", "template", "pageType", "seo", "h1", "blocks", "cta", "faq", "breadcrumbs", "links", "images", "schema", "region"];
  const missing = required.filter((key) => !(key in page));
  if (missing.length) throw new Error(`${page.output || "Page"}: missing fields ${missing.join(", ")}`);
  if (!page.seo.title || !page.seo.description) {
    throw new Error(`${page.output}: incomplete SEO model`);
  }
  if (isIndexable(page) && !page.seo.canonical) {
    throw new Error(`${page.output}: indexable page must have canonical`);
  }
  if (page.template === "home" && !Array.isArray(page.specialistGroups)) {
    throw new Error(`${page.output}: home template must have specialistGroups`);
  }
  if (page.template === "category" && !page.path.startsWith("/_prototype/")) {
    const missingCategoryImages = ["heroImage", "overviewImage", "checksImage"].filter((key) => !page.category?.[key]);
    if (missingCategoryImages.length) {
      throw new Error(`${page.output}: category page must have unique ${missingCategoryImages.join(", ")}`);
    }
  }
  if (page.template === "specialist" && !page.path.startsWith("/_prototype/")) {
    const missingSpecialistHero = ["heroImage", "heroAlt"].filter((key) => !page.specialist?.[key]);
    if (missingSpecialistHero.length) {
      throw new Error(`${page.output}: specialist page must have unique ${missingSpecialistHero.join(", ")}`);
    }
  }
  if (page.template === "about" && !page.path.startsWith("/_prototype/") && !page.about?.heroImage) {
    throw new Error(`${page.output}: about page must have a unique hero image`);
  }
};

export const build = async () => {
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });

  const site = await readJson("data/site.json");
  const homePage = await readJson("data/pages/prototype-home.json");
  const baseTemplate = await readText("templates/base.html");
  const pageFiles = (await readdir(path.join(src, "data/pages"))).filter((name) => name.endsWith(".json")).sort();
  const pages = await Promise.all(pageFiles.map((file) => readJson(`data/pages/${file}`)));
  const readyRoutes = new Set(pages.filter((page) => page.status === "ready").map((page) => page.path));
  const navigation = buildHeaderNavigation(site.navigation, homePage, pages, readyRoutes);
  const header = await renderHeader({ ...site, navigation }, readyRoutes);
  const footer = await renderFooter(site, readyRoutes);

  for (const page of pages) {
    validatePageModel(page);
    const region = { ...site.defaultRegion, ...page.region };
    const pageTemplate = await readText(`templates/${page.template}.html`);
    const form = page.template === "request" || page.showForm ? await renderForm(page, region) : "";
    const category = page.category || {};
    const specialist = page.specialist || {};
    const contacts = page.contacts || {};
    const about = page.about || {};
    const main = renderTokens(pageTemplate, {
      breadcrumbs: await renderBreadcrumbs(page.breadcrumbs),
      cards: await renderCards(page.cards, readyRoutes),
      categoryChecks: renderCategoryChecks(category.checks),
      categoryChecksAlt: escapeHtml(category.checksImageAlt || ""),
      categoryChecksHeight: String(category.checksImageHeight || 1024),
      categoryChecksImage: escapeHtml(category.checksImage || ""),
      categoryChecksTitle: escapeHtml(category.checksTitle || ""),
      categoryChecksWidth: String(category.checksImageWidth || 1536),
      categoryForm: page.template === "category" ? renderCategoryForm(form, category.formTitle) : "",
      categoryHeroAlt: escapeHtml(category.heroAlt || ""),
      categoryHeroHeight: String(category.heroHeight || 821),
      categoryHeroImage: escapeHtml(category.heroImage || ""),
      categoryHeroLead: escapeHtml(category.heroLead || ""),
      categoryHeroWidth: String(category.heroWidth || 1915),
      categoryIntro: escapeHtml(category.intro || ""),
      categoryOverviewAlt: escapeHtml(category.overviewImageAlt || ""),
      categoryOverviewHeight: String(category.overviewImageHeight || 1402),
      categoryOverviewImage: escapeHtml(category.overviewImage || ""),
      categoryIntroTitle: escapeHtml(category.introTitle || ""),
      categoryListTitle: escapeHtml(category.listTitle || ""),
      categoryOverviewWidth: String(category.overviewImageWidth || 1122),
      categoryProcess: renderProcessSteps(category.process),
      categoryProcessTitle: escapeHtml(category.processTitle || ""),
      categoryRequirements: renderCategoryRequirements(category.requirements),
      categoryRequirementsTitle: escapeHtml(category.requirementsTitle || ""),
      aboutApproach: escapeHtml(about.approach || ""),
      aboutCoordinationAlt: escapeHtml(about.coordinationAlt || ""),
      aboutCoordinationHeight: String(about.coordinationHeight || 1400),
      aboutCoordinationImage: escapeHtml(about.coordinationImage || ""),
      aboutCoordinationWidth: String(about.coordinationWidth || 1120),
      aboutForm: page.template === "about" ? renderCategoryForm(form, about.formTitle) : "",
      aboutHeroAlt: escapeHtml(about.heroAlt || ""),
      aboutHeroHeight: String(about.heroHeight || 821),
      aboutHeroImage: escapeHtml(about.heroImage || ""),
      aboutHeroLead: escapeHtml(about.heroLead || ""),
      aboutHeroWidth: String(about.heroWidth || 1915),
      aboutMissionLead: escapeHtml(about.missionLead || ""),
      aboutMissionNote: escapeHtml(about.missionNote || ""),
      aboutMissionTitle: escapeHtml(about.missionTitle || ""),
      aboutOutcomes: renderAboutOutcomes(about.outcomes),
      aboutOutcomesLead: escapeHtml(about.outcomesLead || ""),
      aboutOutcomesTitle: escapeHtml(about.outcomesTitle || ""),
      aboutPrinciples: renderAboutPrinciples(about.principles),
      aboutPrinciplesIntro: escapeHtml(about.principlesIntro || ""),
      aboutPrinciplesTitle: escapeHtml(about.principlesTitle || ""),
      aboutSteps: renderAboutSteps(about.steps),
      aboutStepsTitle: escapeHtml(about.stepsTitle || ""),
      contactsChannels: renderContactChannels(contacts.channels),
      contactsChecklist: renderContactChecklist(contacts.checklist),
      contactsHeroAlt: escapeHtml(contacts.heroAlt || ""),
      contactsHeroHeight: String(contacts.heroHeight || 821),
      contactsHeroImage: escapeHtml(contacts.heroImage || ""),
      contactsHeroLead: escapeHtml(contacts.heroLead || ""),
      contactsHeroWidth: String(contacts.heroWidth || 1915),
      contactsIntro: escapeHtml(contacts.intro || ""),
      contactsIntroTitle: escapeHtml(contacts.introTitle || ""),
      contactsChecklistTitle: escapeHtml(contacts.checklistTitle || ""),
      contactsFormTitle: escapeHtml(contacts.formTitle || "Оставьте заявку"),
      cta: await renderCta(page.cta),
      eyebrow: escapeHtml(page.eyebrow || ""),
      faq: await renderFaq(page.faq, page.pageType),
      form,
      h1: escapeHtml(page.h1),
      lead: escapeHtml(page.lead || ""),
      specialistCards: await renderSpecialistCards(page.specialistGroups || [], readyRoutes),
      specialistChecks: renderSpecialistChecks(specialist.checks),
      specialistChecksImage: escapeHtml(specialist.checksImage || ""),
      specialistChecksImageAlt: escapeHtml(specialist.checksImageAlt || ""),
      specialistChecksImageHeight: String(specialist.checksImageHeight || 1000),
      specialistChecksImageWidth: String(specialist.checksImageWidth || 1600),
      specialistChecksText: escapeHtml(specialist.checksText || ""),
      specialistChecksTitle: escapeHtml(specialist.checksTitle || ""),
      specialistResultText: escapeHtml(specialist.resultText || ""),
      specialistResultTitle: escapeHtml(specialist.resultTitle || ""),
      specialistResultItems: renderSpecialistResultItems(specialist.resultItems),
      specialistResultNote: escapeHtml(specialist.resultNote || ""),
      specialistTeam: renderSpecialistTeam(specialist),
      specialistObjections: renderSpecialistObjections(specialist),
      specialistFormText: escapeHtml(specialist.formText || ""),
      specialistFormTitle: escapeHtml(specialist.formTitle || "Оставьте заявку"),
      specialistFinalForm: page.template === "specialist" ? await renderForm(page, region, { idSuffix: "final", includeValidationModal: false }) : "",
      specialistHeroAlt: escapeHtml(specialist.heroAlt || ""),
      specialistHeroHeight: String(specialist.heroHeight || 821),
      specialistHeroImage: escapeHtml(specialist.heroImage || ""),
      specialistHeroLead: escapeHtml(specialist.heroLead || ""),
      specialistHeroWidth: String(specialist.heroWidth || 1915),
      specialistProcess: renderSpecialistProcess(specialist.process),
      specialistProcessImage: escapeHtml(specialist.processImage || ""),
      specialistProcessImageAlt: escapeHtml(specialist.processImageAlt || ""),
      specialistProcessImageHeight: String(specialist.processImageHeight || 1000),
      specialistProcessImageWidth: String(specialist.processImageWidth || 1600),
      specialistProcessTitle: escapeHtml(specialist.processTitle || ""),
      specialistTasks: renderSpecialistTasks(specialist.tasks),
      specialistTasksImage: escapeHtml(specialist.tasksImage || ""),
      specialistTasksImageAlt: escapeHtml(specialist.tasksImageAlt || ""),
      specialistTasksImageHeight: String(specialist.tasksImageHeight || 1402),
      specialistTasksImageWidth: String(specialist.tasksImageWidth || 1122),
      specialistTasksIntro: escapeHtml(specialist.tasksIntro || ""),
      specialistTasksTitle: escapeHtml(specialist.tasksTitle || ""),
    });
    const head = renderHeadExtras(page, site);
    const html = renderTokens(baseTemplate, {
      bodyClass: escapeHtml(`${page.bodyClass || ""}${["home", "category", "specialist", "contacts", "about"].includes(page.template) ? " page-template--hero-layout" : ""}`),
      canonical: head.canonical,
      description: escapeHtml(page.seo.description),
      footer,
      header,
      main,
      openGraph: head.openGraph,
      pageType: escapeHtml(page.pageType),
      regionSlug: escapeHtml(region.region_slug),
      robots: escapeHtml(robotsFor(page)),
      schema: head.schema,
      title: escapeHtml(page.seo.title),
    });
    const outputPath = path.join(dist, page.output);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, html, "utf8");
  }

  await cp(path.join(src, "assets"), path.join(dist, "assets"), { recursive: true });
  await mkdir(path.join(dist, "assets/images"), { recursive: true });
  await mkdir(path.join(dist, "assets/icons"), { recursive: true });

  const library = path.join(root, "Template libraries", "иконки");
  await cp(path.join(library, "Логотип полный.svg"), path.join(dist, "assets/images/logo-full.svg"));
  await cp(path.join(library, "Графический логотип.svg"), path.join(dist, "assets/images/logo-mark.svg"));

  const iconSource = path.join(library, "bootstrap-icons-repo", "icons");
  const icons = [
    "building-gear.svg",
    "building.svg",
    "boxes.svg",
    "arrow-up-right-square.svg",
    "calendar-check.svg",
    "check-circle.svg",
    "check-circle-fill.svg",
    "check-lg.svg",
    "clipboard-check.svg",
    "envelope-fill.svg",
    "cone-striped.svg",
    "car-front.svg",
    "diagram-2.svg",
    "exclamation-triangle.svg",
    "file-earmark-check.svg",
    "fuel-pump.svg",
    "gear.svg",
    "geo-alt.svg",
    "geo-alt-fill.svg",
    "image.svg",
    "map.svg",
    "minecart-loaded.svg",
    "people.svg",
    "person-badge.svg",
    "person-check.svg",
    "person-workspace.svg",
    "phone-fill.svg",
    "recycle.svg",
    "shield-check.svg",
    "signpost-2.svg",
    "sliders.svg",
    "tools.svg",
    "truck-flatbed.svg",
    "truck-front.svg",
    "truck.svg"
  ];
  for (const icon of icons) {
    await cp(path.join(iconSource, icon), path.join(dist, "assets/icons", icon));
  }

  await mkdir(path.join(dist, "actions"), { recursive: true });
  await cp(path.join(src, "server", "form-lib.php"), path.join(dist, "actions", "form-lib.php"));
  await cp(path.join(src, "server", "send-request.php"), path.join(dist, "actions", "send-request.php"));
  await cp(path.join(src, "seo", "robots.txt"), path.join(dist, "robots.txt"));
  await writeFile(path.join(dist, "sitemap.xml"), renderSitemap(pages), "utf8");

  return { dist, pages: pageFiles.length };
};

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const result = await build();
  process.stdout.write(`Built ${result.pages} pages in ${result.dist}\n`);
}
