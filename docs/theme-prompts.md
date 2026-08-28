# ZCode Skin 主题提示词库

做主题缺背景图？把下面的提示词复制给任何 AI 绘图工具（即梦、Midjourney、DALL·E 等），
生成的图下载后跑：

```bash
node create-theme.mjs --image 生成的图.png --name "主题名"
```

或在 ZCode 界面的 🎨 主题中心里点「＋ 自定义图片」直接上传——配色、深浅、按钮可见度都会自动处理。

通用要点：**干净的 16:9 横版壁纸**（ZCode 窗口比例），**不要有文字**，主体放在两侧或中央偏下
（窗口中间是聊天内容区，放主体会被挡住）。

---

## 1. 极光蓝调（对应内置「极光蓝 · 玻璃」风格）

> 16:9 desktop wallpaper, deep navy night sky with aurora borealis in teal and blue, soft volumetric light, dark corners for UI readability, minimal, cinematic, no text, no watermark

## 2. 落日熔金

> 16:9 desktop wallpaper, golden hour sunset over calm ocean, warm amber and deep orange gradient sky, silhouette of distant mountains, dark lower half for UI, no text

## 3. 赛博霓虹

> 16:9 desktop wallpaper, cyberpunk city at night, neon magenta and cyan lights, rain reflections on street, dark moody atmosphere, blade runner style, no text

## 4. 薄荷晨雾

> 16:9 desktop wallpaper, soft pastel morning mist over green hills, mint and cream color palette, gentle sunlight, clean minimal composition, light and airy, no text

## 5. 和风樱雨

> 16:9 desktop wallpaper, japanese cherry blossom branches over dark indigo night, falling petals, moonlight, soft pink accents on deep blue, elegant, no text

## 6. 星云深处

> 16:9 desktop wallpaper, purple and magenta nebula in deep space, scattered stars, subtle galaxy spiral, very dark background, cosmic and vast, no text

## 7. 水墨远山

> 16:9 desktop wallpaper, traditional chinese ink wash painting, misty mountains and pine trees, black grey and cream palette, vast negative space, zen minimal, no text

## 8. 雨夜街灯

> 16:9 desktop wallpaper, rainy tokyo street at night, warm street lamp glow, reflections on wet asphalt, umbrellas silhouette, dark and cinematic, no text

---

生成后的小技巧：

- 图太亮/太暗不用担心——工具会自动判定主题深浅，主色看不清时会自动校正亮度
- 想强制深色主题：`node create-theme.mjs --image 图.png --name 名字 --appearance dark`
- 对同名主题重新生成时加 `--force` 覆盖
