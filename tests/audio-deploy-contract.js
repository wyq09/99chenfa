#!/usr/bin/env node
/* 配音可听见 + 部署能完成：源码契约，防止再出现「mp3 在服务器、JS 仍走 Web Speech」 */
'use strict';
var fs = require('fs');
var path = require('path');
var assert = require('assert');
var root = path.join(__dirname, '..');

var audioJs = fs.readFileSync(path.join(root, 'js/audio.js'), 'utf8');
var deployYml = fs.readFileSync(path.join(root, '.github/workflows/deploy.yml'), 'utf8');
var gameJs = fs.readFileSync(path.join(root, 'js/game.js'), 'utf8');

/* 1. 播放器必须走预生成 mp3，且游戏会调用 say */
assert.match(audioJs, /say:\s*say/);
assert.match(gameJs, /A\.say\(/);
assert.match(audioJs, /manifest\.files/);

/* 2. 不能每个 key 新建 Audio：iOS 解锁不传递。必须复用同一个元素，或走已 resume 的 AudioContext */
assert.match(audioJs, /decodeAudioData/, 'mp3 应通过已解锁的 AudioContext 解码播放，避免异步 play() 被自动播放策略拦截');
assert.doesNotMatch(audioJs, /new global\.Audio\('audio\/' \+ manifest\.files\[key\]\)/, '禁止按 key 新建 Audio 元素');

/* 3. 部署必须把站点与 audio 拆开，并给够超时：18MB 整包 scp 会把 15min job 卡死 */
assert.match(deployYml, /timeout-minutes:\s*(30|4[05]|[5-9]\d)/, '部署超时至少 30 分钟');
assert.match(deployYml, /--exclude='\.\/audio'/, '站点 tar 必须排除 audio/，避免每次 18MB scp 超时');
assert.match(deployYml, /audio\.tar\.gz/, '音频单独打包，仅在服务器缺失时上传');

/* 4. 本地 mp3 与清单齐全，部署后才有东西可播 */
var manifest = JSON.parse(fs.readFileSync(path.join(root, 'audio/manifest.json'), 'utf8'));
assert.ok(manifest.files && manifest.files.q_3x4 === 'q_3x4.mp3');
var mp3 = fs.readFileSync(path.join(root, 'audio/q_3x4.mp3'));
assert.ok(mp3.slice(0, 3).toString() === 'ID3' || mp3[0] === 0xff, 'q_3x4.mp3 必须是合法 mp3');
assert.ok(Object.keys(manifest.files).length > 400, '清单条目过少');

/* 5. 启动预生成翻卡片不得读题，否则首次点击会把挂起的题目和欢迎语叠播 */
assert.match(gameJs, /newFlashcard\(\{\s*silent:\s*true\s*\}\)/);
assert.match(audioJs, /tok !== voiceToken/);
assert.match(audioJs, /stopCurrentSrc\(\)/);

/* 6. 错题全部练完时没有「再练一次」，绑事件必须判空，否则抛错导致「返回报告」点了没反应 */
assert.doesNotMatch(gameJs, /\$\('r-replay'\)\.addEventListener/, 'r-replay 可能不存在，不能直接绑事件');
assert.match(gameJs, /if \(replayBtn\)/);

console.log('audio-deploy-contract: ok');
