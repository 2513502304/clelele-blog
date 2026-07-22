import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createHpoiImageProxyUrl, isAllowedHpoiImageUrl } from './image';
import { isHpoiCollectionFragment, isHpoiCollectionPage, parseHpoiCollection, parseHpoiProfile } from './parser';

describe('parseHpoiProfile', () => {
  it('reads identity and public collection statistics', () => {
    const profile = parseHpoiProfile(
      `
        <div class="hpoi-user-avatar"><img src="https://rfx.hpoi.net/avatar.jpg"></div>
        <span class="hpoi-user-nickname">clelele</span>
        <p class="hpoi-user-sign">还没有信仰</p>
        <div class="hpoi-item-top">
          <a><span class="hpoi-stats-title">已入手</span><p class="hpoi-stats-label">2</p></a>
          <a><span class="hpoi-stats-title">历史消费</span><p class="hpoi-stats-label">2714.06人民币</p></a>
          <a><span class="hpoi-stats-title">日亚涨跌</span><p class="hpoi-stats-label"><small>+83%</small></p></a>
          <a><span class="hpoi-stats-title">想买</span><p class="hpoi-stats-label">2</p></a>
          <a><span class="hpoi-stats-title">预订</span><p class="hpoi-stats-label">1</p></a>
          <a><span class="hpoi-stats-title">待补款</span><p class="hpoi-stats-label">555.00人民币</p></a>
        </div>
      `,
      '783694',
    );

    assert.equal(profile.name, 'clelele');
    assert.equal(profile.avatarUrl, 'https://rfx.hpoi.net/avatar.jpg');
    assert.equal(profile.signature, '还没有信仰');
    assert.deepEqual(profile.stats, {
      owned: '2',
      totalSpent: '2714.06人民币',
      amazonChange: '+83%',
      wanted: '2',
      preordered: '1',
      pendingPayment: '555.00人民币',
    });
  });
});

describe('Hpoi image proxy URLs', () => {
  it('only accepts public Hpoi CDN image paths', () => {
    const source = 'https://rfx.hpoi.net/gk/cover/n/example.jpg';
    assert.equal(isAllowedHpoiImageUrl(source), true);
    assert.equal(isAllowedHpoiImageUrl('http://rfx.hpoi.net/gk/cover.jpg'), false);
    assert.equal(isAllowedHpoiImageUrl('https://example.com/gk/cover.jpg'), false);
    assert.equal(createHpoiImageProxyUrl(source), `/api/hpoi/image?source=${encodeURIComponent(source)}`);
  });
});

describe('parseHpoiCollection', () => {
  it('parses large-card collection items', () => {
    const items = parseHpoiCollection(`
      <div class="hpoi-collect-container">
        <div class="collect-hobby-list-large">
          <div class="item">
            <a class="cover" href="hobby/82123"><img src="https://rfx.hpoi.net/cover.jpg" alt="伊蕾娜"></a>
            <div class="name"><a href="hobby/82123" title="魔女之旅 伊蕾娜">魔女之旅 伊蕾娜</a></div>
          </div>
        </div>
      </div>
    `);

    assert.deepEqual(items, [
      {
        id: '82123',
        title: '魔女之旅 伊蕾娜',
        imageUrl: 'https://rfx.hpoi.net/cover.jpg',
        detailUrl: 'https://www.hpoi.net/hobby/82123',
        releaseText: null,
        releaseDate: null,
        score: null,
      },
    ]);
  });

  it('parses compact-list metadata and recognizes a valid empty page', () => {
    const html = `
      <div class="hpoi-collect-container">
        <div class="collect-hobby-list-small">
          <div class="item">
            <a class="cover" href="/hobby/65209">
              <img src="https://rfx.hpoi.net/gk/cover/s/2021/04/example.jpeg" alt="雪乃与结衣">
            </a>
            <div class="info">
              <a class="name" title="雪乃与结衣" href="hobby/65209">雪乃与结衣</a>
              <p class="pay">出荷：2022年7月26日</p>
              <span class="score">评分：<small>4.7</small></span>
            </div>
          </div>
        </div>
      </div>
    `;

    const [item] = parseHpoiCollection(html);
    assert.equal(item.releaseText, '出荷：2022年7月26日');
    assert.equal(item.releaseDate, '2022-07-26');
    assert.equal(item.score, '4.7');
    assert.equal(item.imageUrl, 'https://rfx.hpoi.net/gk/cover/n/2021/04/example.jpeg');
    assert.equal(isHpoiCollectionPage('<div class="hpoi-collect-container"><p>还没有内容</p></div>'), true);
    assert.equal(isHpoiCollectionPage('<h1>Request blocked</h1>'), false);
    assert.equal(isHpoiCollectionFragment('<div class="collect-hobby-list-small"><div class="item"></div></div>'), true);
    assert.equal(isHpoiCollectionFragment('<h1>Request blocked</h1>'), false);
  });
});
