import test from 'node:test';
import assert from 'node:assert/strict';
import {loadSlides} from '../apps/desktop/src/pptx-parser.ts';
import * as kit from '../apps/desktop/node_modules/@office-kit/pptx/dist/index.js';

test('reads and renders a presentation with Chinese text',async()=>{
 const presentation=kit.createPresentation();const slide=kit.addBlankSlide(presentation);
 kit.addSlideTextBox(slide,{x:kit.inches(1),y:kit.inches(1),w:kit.inches(4),h:kit.inches(1),text:'项目周报'});
 const deck=await loadSlides(await kit.savePresentation(presentation));
 assert.equal(deck.count,1);assert.match(deck.render(0),/<svg/);assert.match(deck.render(0),/项目周报/);assert.throws(()=>deck.render(1),/Invalid slide/);
});
test('rejects corrupt presentations',async()=>{await assert.rejects(loadSlides(Uint8Array.from([1,2,3])))});
