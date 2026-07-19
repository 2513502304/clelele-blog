---
layout: ../layouts/PageLayout.astro
title: '歌单'
description: '最近在听的音乐'
---

<!-- media 标签会从列表 URL 解析平台、资源类型和歌单 ID，再交给站点配置的 Meting API。 -->
{% media audio %}
- title: 最近在听
  list:
    - https://music.163.com/#/playlist?id=18137747188
{% endmedia %}
