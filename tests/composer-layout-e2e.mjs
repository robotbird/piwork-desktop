import {_electron as electron, expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root=await mkdtemp(path.join(os.tmpdir(),'piwork-composer-layout-'));
let app;
try {
  app=await electron.launch({
    executablePath:path.resolve('apps/desktop/node_modules/.bin/electron'),
    args:[path.resolve('apps/desktop'),`--user-data-dir=${path.join(root,'profile')}`],
    env:{...process.env,VITE_DEV_SERVER_URL:'',PIWORK_DEFAULT_SKILLS_DIR:path.join(root,'no-skills')},
  });
  const page=await app.firstWindow();
  await page.waitForLoadState('load');
  await page.evaluate(async()=>{
    await window.desktop.setGateway({baseUrl:'http://127.0.0.1:1/v1',modelId:'DeepSeek V4.1 Flash long model name',apiKey:'',supportsImages:false});
    localStorage.setItem('piwork.preview-width','960');
    localStorage.setItem('piwork.preview-collapsed','0');
  });
  const results=[];
  for (const language of ['en','zh-CN']) {
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1800,820));
    await page.waitForFunction(()=>innerWidth===1800);
    await page.evaluate(async language=>{
      await window.desktop.setPreferences({appearance:'light',language,permission:'full'});
      localStorage.setItem('piwork.preview-width','960');
    },language);
    await page.reload();
    await page.locator('.composer-actions').waitFor();
    const separator=page.locator('.preview-resizer');
    const handle=await separator.boundingBox();
    assert(handle);
    await page.mouse.move(handle.x+handle.width-2,handle.y+100);
    await page.mouse.down();
    await page.mouse.move(270,handle.y+100,{steps:12});
    await page.mouse.up();
    await expect.poll(()=>page.locator('main').evaluate(node=>Math.round(node.getBoundingClientRect().width))).toBe(320);
    assert(await page.locator('.file-preview').evaluate(node=>node.getBoundingClientRect().width)>960);
    await separator.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(()=>page.locator('main').evaluate(node=>Math.round(node.getBoundingClientRect().width))).toBe(344);
    await page.reload();
    await expect.poll(()=>page.locator('main').evaluate(node=>Math.round(node.getBoundingClientRect().width))).toBe(344);
    // Expanding navigation must keep the chat usable at the maximum dock width.
    await page.locator('.sidebar-header-actions button').last().click();
    await expect.poll(()=>page.locator('.sidebar').evaluate(node=>Math.round(node.getBoundingClientRect().width))).toBe(48);
    await separator.focus();
    for(let i=0;i<12;i++)await page.keyboard.press('ArrowLeft');
    await expect.poll(()=>page.locator('main').evaluate(node=>Math.round(node.getBoundingClientRect().width))).toBe(320);
    await page.locator('.sidebar-header-actions button').last().click();
    await expect.poll(()=>page.locator('.sidebar').evaluate(node=>Math.round(node.getBoundingClientRect().width))).toBe(260);
    await expect.poll(()=>page.locator('main').evaluate(node=>Math.round(node.getBoundingClientRect().width))).toBe(320);
    for (const width of [1800,1440,1240,1104,1000,800]) {
      await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setSize(width,820),width);
      await page.waitForFunction(width=>innerWidth===width,width);
      await expect(page.locator('.composer-shell')).toBeVisible();
      // Wait for the resize handler to clamp the dock before measuring the pane.
      await page.waitForFunction(()=>innerWidth<=1100 || document.querySelector('main').getBoundingClientRect().width>=319.5);
      const result=await page.locator('.composer-actions').evaluate(actions=>{
        const form=actions.closest('form').getBoundingClientRect();
        const pane=actions.closest('main').getBoundingClientRect();
        const buttons=[...actions.querySelectorAll('button')];
        return {
          paneWidth:pane.width,
          composerWidth:form.width,
          contained:buttons.every(button=>{
            const box=button.getBoundingClientRect();
            return box.width>=31 && box.left>=form.left && box.right<=form.right && box.right<=pane.right;
          }),
          overlapping:buttons.some((button,index)=>index>0 && button.getBoundingClientRect().left<buttons[index-1].getBoundingClientRect().right-1),
          overflow:actions.scrollWidth>actions.clientWidth,
        };
      });
      assert.equal(result.contained,true,JSON.stringify({language,width,...result}));
      assert.equal(result.overlapping,false,JSON.stringify({language,width,...result}));
      assert.equal(result.overflow,false,JSON.stringify({language,width,...result}));
      results.push({language,width,...result});
      if(width===1104) {
        await expect(page.locator('.composer-permission-label')).toBeHidden();
        await expect(page.locator('.composer-model-label')).toBeHidden();
        await page.locator('.composer-permission-trigger').click();
        await expect(page.getByRole('menuitemradio',{checked:true})).toBeVisible();
        await page.keyboard.press('Escape');
        await page.locator('.composer-model-trigger').click();
        await expect(page.getByRole('menuitemradio',{checked:true})).toBeVisible();
        await page.keyboard.press('Escape');
        await mkdir('.visual-tmp',{recursive:true});
        await page.screenshot({path:`.visual-tmp/composer-narrow-${language}.png`});
      }
    }
  }
  console.log(JSON.stringify(results,null,2));
} finally {
  await app?.close();
  await rm(root,{recursive:true,force:true});
}
