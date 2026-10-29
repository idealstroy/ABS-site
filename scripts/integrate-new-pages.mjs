import fs from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const read=async p=>JSON.parse(await fs.readFile(new URL(p,root),'utf8'));
const write=async(p,v)=>fs.writeFile(new URL(p,root),JSON.stringify(v,null,2)+'\n','utf8');
const site=await read('src/data/site.json');
const category=await read('src/data/pages/slesari.json');
category.status='ready';
category.seo={...category.seo,robots:'index, follow',canonical:site.domain+category.path,openGraph:true};
category.faqSchema=false;
category.cards.forEach(card=>{card.href=card.productionHref;});
category.schema=[{
  '@context':'https://schema.org','@type':'Service','@id':`${site.domain}${category.path}#service`,
  name:'Предоставление слесарей по ремонту спецтехники и автомобилей',url:site.domain+category.path,
  areaServed:{'@type':'Country',name:'Россия'},provider:{'@id':`${site.domain}#organization`},
},{
  '@context':'https://schema.org','@type':'ItemList','@id':`${site.domain}${category.path}#specialties`,
  name:category.category.listTitle,
  itemListElement:category.cards.map((card,i)=>({'@type':'ListItem',position:i+1,name:card.title,url:site.domain+card.href})),
}];
await write('src/data/pages/slesari.json',category);
const home=await read('src/data/pages/home.json');
const operators=await read('src/data/pages/mashinisty-spetstehniki.json');
const motorist=await read('src/data/pages/motorist-tsementirovochnogo-agregata.json');
if(!operators.cards.some(card=>card.href===motorist.path))operators.cards.push({icon:'gear.svg',title:'Мотористы цементировочного агрегата',description:'Для работы на цементировочных агрегатах с учётом оборудования, операций и условий объекта.',href:motorist.path,columnClass:'col-12 col-md-6 col-xl-6'});
const operatorGroup=home.specialistGroups.find(g=>g.title==='Машинисты и операторы');
if(!operatorGroup.items.some(item=>item.href===motorist.path))operatorGroup.items.push({title:'Мотористы цементировочного агрегата',href:motorist.path,icon:'gear.svg'});
if(!home.specialistGroups.some(group=>group.title==='Слесари'))home.specialistGroups.push({title:'Слесари',description:'Для обслуживания и ремонта техники на объектах и ремонтных базах',items:category.cards.map(card=>({title:card.title,href:card.href,icon:card.icon}))});
await write('src/data/pages/home.json',home);
await write('src/data/pages/mashinisty-spetstehniki.json',operators);
const planned=await read('src/data/planned-specialties.json');
planned.pages.forEach(page=>{page.status='ready';});
planned.sections?.filter(section=>section.path==='/slesari/').forEach(section=>{section.status='ready';});
await write('src/data/planned-specialties.json',planned);
console.log('Integrated four production page models and their parent links');
