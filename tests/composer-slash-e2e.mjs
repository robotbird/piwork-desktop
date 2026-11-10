import assert from 'node:assert/strict';
import {_electron as electron, expect} from '@playwright/test';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root=await mkdtemp(path.join(os.tmpdir(),'piwork-composer-slash-'));
const skillsDir=path.join(root,'skills');
let app;
try {
  for(const name of ['alpha','beta']) {
    const folder=path.join(skillsDir,name);
    await mkdir(folder,{recursive:true});
    await writeFile(path.join(folder,'SKILL.md'),`---\nname: ${name}\ndescription: ${name} helper\n---\nHelp with notes.\n`);
  }
  app=await electron.launch({
    executablePath:path.resolve('apps/desktop/node_modules/.bin/electron'),
    args:[path.resolve('apps/desktop'),`--user-data-dir=${path.join(root,'profile')}`],
    env:{...process.env,VITE_DEV_SERVER_URL:'',PIWORK_DEFAULT_SKILLS_DIR:skillsDir},
  });
  const page=await app.firstWindow();
  await page.evaluate(()=>window.desktop.setPreferences({appearance:'light',language:'en'}));
  await page.reload();
  const input=page.getByRole('textbox',{name:'Describe what you want to do…'});
  const menu=page.getByRole('listbox',{name:'Skills & MCP'});
  const alpha=page.getByRole('option',{name:/alpha/});
  const mention=page.locator('.composer-skill-mention');

  // Start, adjacent Chinese text, whitespace, and multiline drafts all trigger.
  for(const prefix of ['', '请帮我', 'Please help ', '第一行\n第二行']) {
    await input.fill(prefix);
    await input.press('End');
    await page.keyboard.type('/');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('option')).toHaveCount(2);
    await page.keyboard.type('alp');
    await expect(menu.getByRole('option')).toHaveCount(1);
    await input.press('Enter');
    await expect(input).toHaveValue(prefix+'\u2003alpha ');
    await expect(mention).toHaveText('alpha');
    await expect(mention.locator('.composer-skill-icon svg')).toHaveCount(1);
    await expect(mention).not.toContainText('/');
    await expect(page.locator('.capability-chips')).toHaveCount(0);
    await expect(mention).toHaveCSS('color','rgb(30, 64, 175)');
    await expect(menu).toBeHidden();
    await expect(input).toBeFocused();
  }

  // Insertion in the middle preserves the suffix and restores the caret.
  const prefix='请帮我', suffix='整理这份文档';
  await input.fill(prefix+suffix);
  await input.press('Home');
  for(let i=0;i<prefix.length;i++)await input.press('ArrowRight');
  await page.keyboard.type('/bet');
  await expect(page.getByRole('option',{name:/beta/})).toBeVisible();
  await page.getByRole('option',{name:/beta/}).click();
  await expect(input).toHaveValue(prefix+'\u2003beta '+suffix);
  await expect(input).toBeFocused();
  await expect.poll(()=>input.evaluate(node=>node.selectionStart)).toBe(prefix.length+'\u2003beta '.length);
  await page.keyboard.type('先');
  await expect(input).toHaveValue(prefix+'\u2003beta 先'+suffix);

  // A new slash wins over earlier slashes; selecting it leaves earlier text intact.
  await input.fill('保留/原文/');
  await expect(menu).toBeVisible();
  await alpha.click();
  await expect(input).toHaveValue('保留/原文\u2003alpha ');
  await expect(menu).toBeHidden();

  // Escape dismisses without editing; another slash reopens the menu.
  await input.fill('内容/');
  await expect(menu).toBeVisible();
  await input.press('Escape');
  await expect(menu).toBeHidden();
  await expect(input).toHaveValue('内容/');
  await page.keyboard.type('/');
  await expect(menu).toBeVisible();
  await input.press('ArrowDown');
  const selectedName=await menu.getByRole('option',{selected:true}).locator('.slash-option-name').textContent();
  await page.keyboard.press('Enter');
  await expect(mention).toHaveText(selectedName);
  await expect(input).toHaveValue(`内容/\u2003${selectedName} `);

  // Moving away closes the menu; moving back restores caret-based filtering.
  await input.fill('开头 /alp 后文');
  await expect(menu).toBeHidden();
  await input.press('Home');
  for(let i=0;i<'开头 /alp'.length;i++)await input.press('ArrowRight');
  await expect(alpha).toBeVisible();
  await input.press('Home');
  await expect(menu).toBeHidden();
  await input.fill('内容/does-not-exist');
  await expect(menu).toBeHidden();
  await input.fill('内容/alpha ');
  await expect(menu).toBeHidden();

  // Edits before and after the mention preserve its position and selection.
  await input.fill('整理/');
  await alpha.click();
  await input.press('Home');
  await page.keyboard.type('Please ');
  await expect(mention).toHaveText('alpha');
  await input.press('End');
  await page.keyboard.type('继续');
  await expect(mention).toHaveText('alpha');
  await expect(input).toHaveValue('Please 整理\u2003alpha 继续');

  // Choosing another skill moves the single active mention to the new location.
  await page.keyboard.type('/bet');
  await page.getByRole('option',{name:/beta/}).click();
  await expect(mention).toHaveText('beta');
  await expect(input).toHaveValue('Please 整理 继续\u2003beta ');
  await input.press('Backspace'); // trailing space
  await input.press('Backspace'); // the complete skill name
  await expect(mention).toHaveCount(0);
  await expect(input).toHaveValue('Please 整理 继续');
  await expect(input).toHaveCSS('color',await page.locator('.composer-highlight').evaluate(node=>getComputedStyle(node).color));

  // Long, wrapped text stays aligned while scrolling and resizing.
  await input.fill('第一行\n'.repeat(24)+'末行/');
  await alpha.click();
  await expect(mention).toHaveText('alpha');
  await input.evaluate(node=>{node.scrollTop=node.scrollHeight;node.dispatchEvent(new Event('scroll'))});
  await expect.poll(()=>page.locator('.composer-input').evaluate(node=>Math.abs(node.querySelector('textarea').scrollTop-node.querySelector('.composer-highlight').scrollTop))).toBeLessThan(1);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1000,820));
  for(const property of ['fontFamily','fontSize','lineHeight','padding','width','whiteSpace','overflowWrap']) {
    const [native,mirror]=await page.locator('.composer-input').evaluate((node,property)=>[getComputedStyle(node.querySelector('textarea'))[property],getComputedStyle(node.querySelector('.composer-highlight'))[property]],property);
    assert.equal(native,mirror,property);
  }

  // Keep skill metadata separate from prompt text, and restore both on failure.
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1440,820));
  await page.waitForFunction(()=>innerWidth===1440);
  await page.evaluate(()=>window.desktop.setGateway({baseUrl:'http://127.0.0.1:1/v1',modelId:'mock',apiKey:''}));
  await page.reload();
  await app.evaluate(({ipcMain})=>{
    ipcMain.removeHandler('chat:send');
    ipcMain.handle('chat:send',(_event,...args)=>{globalThis.__slashSend=args;throw new Error('fixture send failure')});
  });
  await input.fill('整理/');
  await alpha.click();
  await page.keyboard.type('文档');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect(input).toHaveValue('整理\u2003alpha 文档');
  await expect(mention).toHaveText('alpha');
  await expect(page.getByText('Chat could not finish. Check the model gateway, selected skill or MCP settings.')).toBeVisible();
  const [sentText,,sentSkill]=await app.evaluate(()=>globalThis.__slashSend);
  assert.equal(sentText,'整理 文档');
  const selectedSkill=await page.evaluate(()=>window.desktop.listSkills());
  assert.equal(sentSkill,selectedSkill.find(item=>item.name==='alpha').id);

  // A screenshot keeps the inline location and blue color reviewable.
  await mkdir('.visual-tmp',{recursive:true});
  await page.screenshot({path:'.visual-tmp/composer-inline-skill.png'});
  console.log('Composer slash: inline color and position, edits, deletion, scrolling, filtering and send recovery passed');
} finally {
  await app?.close();
  await rm(root,{recursive:true,force:true});
}
