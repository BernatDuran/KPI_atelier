import {test,expect} from '@playwright/test';

const sizes = [{width:1440,height:1000},{width:1366,height:768},{width:1280,height:720},{width:1093,height:614},{width:1024,height:640}];

test.beforeEach(async ({page}) => {
  await page.route('**/api/pbi/**', route => {
    if (route.request().method() === 'POST') throw Error('Desktop layout tests cannot write to Power BI');
    return route.fulfill({json:{instances:[],connected:false}});
  });
});

for (const size of sizes) for (const dark of [false,true]) {
  test('Desktop '+size.width+'×'+size.height+' '+(dark?'dark':'light')+' keeps tools visible and selected text readable',async ({page},testInfo) => {
    await page.setViewportSize(size);
    await page.goto('/');
    await expect(page.locator('#f-title')).toBeVisible();
    if (dark) await page.locator('[data-action="toggle-ui-theme"]').click();
    const dimensions=await page.evaluate(()=>({width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight}));
    expect(dimensions.width).toBeLessThanOrEqual(size.width);
    expect(dimensions.height).toBeLessThanOrEqual(size.height+1);
    await expect(page.locator('#save-state')).toBeInViewport();
    await page.locator('#f-title').fill('Cambio pendiente visible');
    await expect(page.locator('#save-state')).toContainText('Cambios sin guardar');
    await expect(page.locator('#save-state')).toBeInViewport();
    for (const selector of ['.canvas-toolbar','.canvas-bottom','.palette-section','.inspector-tabs']) {
      const box=await page.locator(selector).boundingBox();
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y+box.height).toBeLessThanOrEqual(size.height);
    }
    await page.locator('#inspector-fields').evaluate(panel=>{panel.scrollTop=panel.scrollHeight;});
    await expect(page.locator('.level-hint')).toBeInViewport();
    await page.locator('#inspector-fields').evaluate(panel=>{panel.scrollTop=0;});
    expect(await page.locator('#f-title').evaluate(input=>parseFloat(getComputedStyle(input).fontSize))).toBeGreaterThanOrEqual(12);
    const contrasts=await page.evaluate(()=>{
      const luminance=rgb=>rgb.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
      const parse=color=>color.match(/[\d.]+/g).map(Number);
      return ['.top-nav button.selected','.mode-switch button.active','.inspector-tabs button.active','.theme-swatch.active small','#f-title','.segmented button:not(.active)','.pixel-step button:not(.active)','.live-label','#family-filter','.mode-switch button:not(.active)'].map(selector=>{
        const node=document.querySelector(selector);let ancestor=node;let bg;
        while(ancestor){bg=parse(getComputedStyle(ancestor).backgroundColor);if(bg.length<4||bg[3]!==0)break;ancestor=ancestor.parentElement;}
        const fg=parse(getComputedStyle(node).color),a=luminance(fg),b=luminance(bg||[255,255,255]);
        return {selector,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
      });
    });
    for (const entry of contrasts) expect(entry.ratio,entry.selector).toBeGreaterThanOrEqual(4.5);
    await expect(page.locator('.theme-swatch.active')).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('.template-item.chosen')).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('[data-action="single"]')).toHaveAttribute('aria-pressed','true');
    await page.locator('[data-action="zoom-fit"]').click();
    const stage=await page.locator('#stage').boundingBox();
    await expect.poll(async()=>(await page.locator('#main-card').boundingBox()).width).toBeLessThanOrEqual(stage.width);
    await expect.poll(async()=>(await page.locator('#main-card').boundingBox()).height).toBeLessThanOrEqual(stage.height);
    await page.evaluate(async()=>{(await import('/state.mjs')).toast('Mensaje de prueba legible');});
    const toastContrast=await page.locator('#toast').evaluate(el=>{const s=getComputedStyle(el),lum=c=>c.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0),a=lum(s.color),b=lum(s.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);});
    expect(toastContrast).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({path:testInfo.outputPath('desktop.png')});
    await page.locator('[data-tab="style"]').click();
    await page.locator('.effect-option.active').scrollIntoViewIfNeeded();
    await expect(page.locator('.effect-option.active')).toHaveAttribute('aria-pressed','true');
    const effectRatios=await page.locator('.effect-option').evaluateAll(options=>options.map(node=>{
      const parse=color=>color.match(/[\d.]+/g).slice(0,3).map(Number);
      const luminance=color=>parse(color).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
      const style=getComputedStyle(node),fg=luminance(style.color),bg=luminance(style.backgroundColor);
      return {effect:node.dataset.surface,ratio:(Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05)};
    }));
    expect(effectRatios).toHaveLength(5);
    for(const effect of effectRatios)expect(effect.ratio,effect.effect).toBeGreaterThanOrEqual(4.5);
  });
}
