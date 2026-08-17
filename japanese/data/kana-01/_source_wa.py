# -*- coding: utf-8 -*-
"""五十音入門書 · わ行 + ん 的原始內容（逐字照書）。平假名到此完結。"""

LESSONS_WA = [
    dict(
        kana='わ', romaji='wa', row='わ行',
        mnemonic='わ･わ･わ！れ･れ･れ！わ、れ（哇咧）！我和青蛙一樣大肚子！',
        origin='字源來自漢字「和」，發音 wa，'
               '和之前學的「れ」字形很像，可以對比記憶。',
        words=[
            ('わに', 'wa ni', '鱷魚', '動物'),
            ('わたし', 'wa ta shi', '我', '人物'),
            ('わるい', 'wa ru i', '壞的、不好的', '情緒'),
            ('わりばし', 'wa ri ba shi', '免洗筷', '物品'),
            ('わなげ', 'wa na ge', '套圈圈遊戲', '文化'),
        ],
        scene='出門前確認',
        dialogue=[
            ('忘れ物はない？', 'wa su re mo no wa na i', '有沒有忘記帶東西？'),
            ('うん、大丈夫。', 'u n, da i jo u bu', '沒有了，沒問題的。'),
        ],
    ),
    dict(
        kana='を', romaji='wo', row='わ行',
        # ★ 這一課的「單字」欄書上給的是助詞用法，不是單字
        word_type='phrase',
        mnemonic='を･を･を！大便要大在馬桶上喔！',
        origin='字源來自漢字「遠」，發音 wo，只做助詞使用，'
               '沒有實體單詞，要專門死記字形。',
        words=[
            ('ごはんを食べる', 'go ha n wo ta be ru', '吃飯', '句型'),
            ('野菜を買う', 'ya sa i wo ka u', '買蔬菜', '句型'),
            ('これをください', 'ko re wo ku da sa i', '我要（買）這個', '句型'),
            ('水を飲む', 'mi zu wo no mu', '喝水', '句型'),
            ('写真を撮る', 'sha shi n wo to ru', '拍照', '句型'),
        ],
        scene='相約吃飯',
        dialogue=[
            ('いっしょにごはんを食べましょう。', 'i s sho ni go ha n wo ta be ma sho u', '我們一起吃飯吧。'),
            ('そうしましょう。', 'so u shi ma sho u', '好，就這樣吧。'),
        ],
    ),
    dict(
        kana='ん', romaji='n', row='',
        mnemonic='ん･ん･ん！h･h･h，長得像h，卻唸n的發音！',
        origin='字源來自漢字「无」，是撥音，字形像英文字 h，但讀音是 n，'
               '不能單獨使用，接在其他假名後面。',
        words=[
            ('かんじ', 'ka n ji', '漢字', '學習'),
            ('こんぶ', 'ko n bu', '昆布', '食物'),
            ('かんてん', 'ka n te n', '寒天', '食物'),
            ('ほんとう', 'ho n to u', '真的', '口語'),
            ('はんがく', 'ha n ga ku', '半價', '購物'),
        ],
        scene='稱讚運氣',
        dialogue=[
            ('運がいいね。', 'u n ga i i ne', '你運氣很好喔！'),
            ('まあね。', 'ma a ne', '還好啦。'),
        ],
    ),
]
