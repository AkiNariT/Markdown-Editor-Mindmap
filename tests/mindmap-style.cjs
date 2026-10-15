const { _electron: electron } = require('playwright');
const { mkdir, mkdtemp, writeFile, readFile } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const base = path.resolve(__dirname, '../.desktop-test'); await mkdir(base,{recursive:true});
  const dir=await mkdtemp(path.join(base,'map-themes-')),profile=path.join(dir,'profile'),file=path.join(dir,'风格测试.mdmap'),note=path.join(dir,'关联笔记.md');
  const node=(id,parent,text,file=null,extra={})=>({id,parent,text,file,collapsed:false,...extra});
  await writeFile(file,JSON.stringify({format:'md-mindmap',version:4,root:'root',nodes:[node('root',null,'让想法自然生长'),node('a','root','阅读与思考','关联笔记.md',{style:'capsule'}),node('b','root','计划与行动'),node('c','root','灵感与记录'),node('a1','a','收集观点 · 建立联系'),node('b1','b','拆分目标 · 逐步推进'),node('c1','c','保留细节 · 持续完善')],connections:[{id:'edge',from:'a',to:'b',label:'从思考到行动'}]}));
  await writeFile(note,'# 关联笔记\n\n保持本地关联。\n');
  let app,page;const errors=[];
  const idle=()=>page.waitForFunction(()=>!document.querySelector('#save').disabled);
  const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const style=()=>page.locator('.mindmap-theme-select'),canvas=()=>page.locator('.mindmap-canvas'),card=id=>page.locator('[data-node-card="'+id+'"]');
  const save=async()=>{await page.locator('#save').click();await idle();await page.waitForFunction(()=>document.querySelector('#dirty-dot').hidden);};
  const start=async(files=[])=>{app=await electron.launch({executablePath:process.env.MOYE_EXE||require('electron'),args:[...(process.env.MOYE_EXE?[]:[path.resolve(__dirname,'..')]),...files,'--user-data-dir='+profile],timeout:30000});page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));await page.waitForSelector('[data-node-id=root]');await idle();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1280,860));await settle();};
  const destroy=async()=>{if(!app)return;await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(window=>window.destroy())).catch(()=>{});await app.close().catch(()=>{});app=null;};
  const fit=async()=>{await page.evaluate(()=>{const c=document.querySelector('.mindmap-canvas'),r=c.getBoundingClientRect(),cards=[...document.querySelectorAll('[data-node-card]')].map(n=>n.getBoundingClientRect());c.scrollLeft+=Math.min(...cards.map(n=>n.left))-r.left-45;c.scrollTop+=Math.min(...cards.map(n=>n.top))-r.top-40;});await settle();};
  const geometry=()=>page.locator('[data-node-card]').evaluateAll(nodes=>nodes.map(node=>[node.dataset.nodeCard,node.style.left,node.style.top]));
  const contrast=async()=>{
    const values=await page.locator('[data-node-card]').evaluateAll(nodes=>nodes.map(node=>{
      const s=node.querySelector('.mindmap-node-outline'),fg=getComputedStyle(node.querySelector('.mindmap-node-title')).color,bg=s?getComputedStyle(s).fill:getComputedStyle(node).backgroundColor;
      const lum=value=>{const [r,g,b]=value.match(/[\d.]+/g).slice(0,3).map(Number).map(c=>{c/=255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;});return r*.2126+g*.7152+b*.0722;};const a=lum(fg),b=lum(bg);return {id:node.dataset.nodeCard,fg,bg,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
    }));for(const value of values)assert.ok(value.ratio>=4.5,JSON.stringify(value));
  };
  try{
    await start([file]);await page.locator('#mode').click();await idle();assert.equal(await page.locator('input[type=color]').count(),0);assert.equal(await page.locator('[data-palette]').count(),8);
    assert.equal(await style().inputValue(),'legacy');assert.deepEqual(await style().locator('option:not([disabled])').evaluateAll(nodes=>nodes.map(n=>n.value)),['classic','rounded','capsule','tree','vine','crystal']);
    for(const [theme,radius]of [['classic','8px'],['rounded','22px'],['capsule','48px']]){await style().selectOption(theme);assert.equal(await card('a').evaluate(n=>getComputedStyle(n).borderRadius),radius);}
    await page.locator('#zoom-out').click();await page.locator('#zoom-out').click();await fit();const before=await geometry();
    for(const appearance of ['light','dark']){
      if(appearance==='dark'){await page.locator('#more-toggle').click();await page.locator('#theme').click();}
      for(const theme of ['tree','vine','crystal']){
        await style().selectOption(theme);await fit();assert.equal(await page.locator('.mindmap-view').getAttribute('data-map-theme'),theme);assert.equal(await page.locator('.mindmap-node-art').count(),7);assert.deepEqual(await geometry(),before);await contrast();
        assert.equal(await page.locator('[data-connection-label=edge]').textContent(),'从思考到行动');const d=await page.locator('.mindmap-branch').first().getAttribute('d');assert.ok(theme==='crystal'?d.includes(' L '):d.includes(' C '));
        const screenshot=path.join(dir,theme+'-'+appearance+'.png');await page.screenshot({path:screenshot});console.log('SCREENSHOT '+screenshot);
      }
    }
    await page.locator('[data-node-id=a]').click();await page.locator('[data-palette=blue]').click();const textColor=()=>card('a').locator('.mindmap-node-title').evaluate(n=>getComputedStyle(n).color);
    assert.equal(await textColor(),'rgb(30, 58, 95)');await contrast();await canvas().focus();await page.keyboard.press('Control+z');assert.notEqual(await textColor(),'rgb(30, 58, 95)');await page.keyboard.press('Control+y');assert.equal(await textColor(),'rgb(30, 58, 95)');
    await save();let saved=JSON.parse(await readFile(file,'utf8'));assert.equal(saved.version,5);assert.equal(saved.theme,'crystal');assert.equal(saved.nodes[1].background,'#dbeafe');assert.equal(saved.nodes[1].color,'#1e3a5f');assert.equal(saved.nodes[1].file,'关联笔记.md');assert.equal(saved.connections[0].label,'从思考到行动');
    const r=await page.locator('[data-node-id=b]').boundingBox();await page.mouse.move(r.x+45,r.y+25);await page.mouse.down();await page.mouse.move(r.x+90,r.y+45,{steps:8});await page.mouse.up();await save();saved=JSON.parse(await readFile(file,'utf8'));assert.ok(saved.nodes.find(n=>n.id==='b').offset);
    // The canvas intentionally suppresses clicks for 400ms after dragging.
    await page.waitForTimeout(450);
    await card('a').locator('.mindmap-file').click();await page.waitForSelector('.tiptap h1');assert.equal(await page.locator('#document-name').textContent(),'关联笔记.md');await page.getByRole('tab',{name:'风格测试.mdmap',exact:true}).click();await idle();
    for(const width of [950,720]){await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,760),width);await settle();const viewport=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(Math.abs(viewport.width-width)<=2,JSON.stringify(viewport));assert.equal(viewport.scroll,viewport.width,JSON.stringify(viewport));for(const selector of ['.mindmap-theme-select','[data-palette=default]','[data-palette=brown]'])assert.ok(await page.locator(selector).evaluate(n=>{const r=n.getBoundingClientRect(),c=document.querySelector('.mindmap-canvas').getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth&&r.bottom<=c.top;}),selector);await page.screenshot({path:path.join(dir,'narrow-'+width+'.png')});}
    await page.locator('#more-toggle').click();await page.locator('#settings').click();await page.locator('#language-select').selectOption('en');await page.waitForFunction(()=>document.documentElement.lang==='en');await page.keyboard.press('Escape');assert.equal(await style().getAttribute('aria-label'),'Map style');assert.equal(await page.locator('[data-palette=blue]').getAttribute('aria-label'),'Palette: Blue');assert.equal(await style().locator('option:checked').textContent(),'Crystal');
    await style().selectOption('vine');await page.locator('[data-node-id=root]').click();await page.locator('[data-palette=purple]').click();const sessionFile=path.join(profile,'session.json');
    for(let i=0;i<100;i++){let session;try{session=JSON.parse(await readFile(sessionFile,'utf8'));}catch{}const entry=session?.documents.find(n=>n.path===file);if(entry?.draft&&JSON.parse(entry.draft).theme==='vine'&&JSON.parse(entry.draft).nodes[0].background==='#eee3f7')break;if(i===99)throw new Error('Theme draft was not persisted');await new Promise(resolve=>setTimeout(resolve,100));}
    const exiting=app.waitForEvent('close');await app.evaluate(()=>{setTimeout(()=>process.exit(0),20);});await exiting;app=null;await start();assert.equal(await page.locator('.mindmap-view').getAttribute('data-map-theme'),'vine');assert.equal(await page.locator('#dirty-dot').isVisible(),true);assert.equal(JSON.parse(await readFile(file,'utf8')).theme,'crystal');await save();assert.equal(JSON.parse(await readFile(file,'utf8')).theme,'vine');assert.deepEqual(errors,[]);
    console.log('MINDMAP STYLE PASS: paired palettes, six map styles, legacy Classic, light/black contrast, geometry, undo, save, drag, linked star, English, narrow controls and v5 recovery.');
  }finally{await destroy();}
})().catch(error=>{console.error(error);process.exitCode=1;});
