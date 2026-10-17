# اللعب المجاني P2P — Firebase signaling + WebRTC

أضيف وضع **مجاني P2P** اختياري بجانب **server-authoritative WebSocket v2**. اختر طريقة الاتصال من شاشة اللعب الجماعي. يبقى WebSocket هو الافتراضي، ولا تتغير أوضاع FFA وTeam المحلية. لا توجد إعدادات Firebase حقيقية أو خدمة Firebase منشورة ضمن المستودع؛ يظهر شرح قابل للتنفيذ بالعربية والإنجليزية إذا كانت الإعدادات ناقصة.

**P2P ليس نظاماً لمكافحة الغش.** المضيف هو متصفح أحد اللاعبين؛ يمكنه نظرياً تعديل المحاكاة أو النقاط أو snapshots. استخدم خادم WebSocket الذي تديره للمنافسات التي تحتاج إلى سلطة موثوقة. Firebase يحمي مسارات الإشارات لكنه لا يستطيع إثبات أن متصفح المضيف ينفذ اللعبة بأمانة.

## إعداد مشروع Firebase حقيقي

1. أنشئ مشروعاً تملكه في [Firebase Console](https://console.firebase.google.com/) واختر **Spark** إن كنت تريد الخطة المجانية. أضف Web App للمشروع وانسخ إعداداته الفعلية، لا إعدادات تطبيق آخر.
2. من **Authentication → Sign-in method** فعّل **Anonymous**. أضف نطاق موقع اللعبة إلى **Authorized domains** عند الحاجة. يستخدم العميل المستخدم المصادق الموجود، أو `signInAnonymously()` إن لم يوجد مستخدم. لا يوجد fallback غير مصادق: قواعد الغرف تتطلب Auth. إعداد Anonymous موثق رسمياً [1].
3. أنشئ **Realtime Database**، وليس Firestore، واختر المنطقة المناسبة. انسخ رابط Database الفعلي من لوحة التحكم؛ قد ينتهي بـ `firebaseio.com` أو `firebasedatabase.app`. لا تستخدم Test mode المفتوح للإنتاج.
4. انشر محتوى `firebase.database.rules.json` من تبويب Rules. أو ثبّت Firebase CLI، وسجّل الدخول بنفسك، واختر مشروعك الفعلي ثم انشر القواعد:

   ```sh
   firebase login
   firebase use --add
   firebase deploy --only database
   ```

   الملف `firebase.json` يشير إلى القواعد فقط؛ **لا توجد `.firebaserc` أو project ID مفبركة للإنتاج**. لم تنفذ هذه المهمة عملية تسجيل دخول أو نشر على Firebase.
5. انسخ `.env.example` إلى `.env.local` واضبط القيم الخمس من Web App الحقيقي:

   ```dotenv
   VITE_MULTIPLAYER_TRANSPORT=peer
   VITE_FIREBASE_API_KEY=
   VITE_FIREBASE_AUTH_DOMAIN=
   VITE_FIREBASE_DATABASE_URL=
   VITE_FIREBASE_PROJECT_ID=
   VITE_FIREBASE_APP_ID=
   ```

   القيم الفارغة أعلاه تعني **غير مُعدّ**؛ استبدلها بقيم مشروعك قبل البناء. إعداد Firebase الخاص بالويب public ويُضمّن في JavaScript، وليس service-account secret. لا تضع مفاتيح حساب خدمة أو Admin SDK أو TURN طويل الصلاحية في متغيرات `VITE_*`. حماية البيانات تعتمد على Rules وليس إخفاء Web Config.
6. نفّذ `pnpm install --frozen-lockfile` ثم `pnpm build`، أو أعد تشغيل `pnpm dev` للتطوير. متغيرات Vite وقت البناء؛ تعديلها بعد رفع `dist` لا يغير النسخة المنشورة. استخدم HTTPS للإنتاج، أو localhost للتطوير، وافتح اللعبة في متصفح يدعم WebRTC DataChannels.

يمكن أيضاً تعيين `"transport": "peer"` في `public/multiplayer/bootstrap.json`. `VITE_MULTIPLAYER_TRANSPORT` له الأولوية على bootstrap؛ رابط دعوة صريح له الأولوية عليهما. زر اختيار النقل يبدّل الجلسة الحالية. **لا حاجة إلى إكمال إعداد Firebase لاستخدام الخادم أو الأوضاع المحلية.** إعداد خادم WebSocket وعنوان `VITE_MULTIPLAYER_URL` يبقيان مستقلين.

## إنشاء الغرفة والبدء

أنشئ الغرفة للفريق الأزرق أو الأحمر، ثم شارك رابط الدعوة المعروض. الرابط يحتوي `match=ROOMCODE&team=blue|red&transport=peer`، ويستعيد طريقة الاتصال تلقائياً. `MultiplayerClient.createPeerRoom(profile, team)` و`joinPeerRoom(room, team, profile)` متاحان أيضاً للاستدعاء البرمجي؛ `create()` و`join()` يستخدمان طريقة الاتصال المختارة.

الغرفة الودية تدعم **1–3 لاعبين لكل فريق**. يلزم وجود لاعب واحد على الأقل بكل فريق واتصال وجاهزية جميع المقاعد المشغولة الأخرى. الضغط على Start يجعل المضيف جاهزاً تلقائياً. المقاعد الزائدة/الانضمام بعد بدء الجولة تكون للمشاهدة. قواعد بدء 3 ضد 3 الصارمة في وضع الخادم لم تتغير. تبين الواجهة **Host / Connected / Waiting** واسم الطريقة، وتعرض إشعاراً عند نقل المضيف أو إعادة بدء الجولة.

أبقِ تبويب المضيف ظاهراً: throttling في تبويبات الخلفية أو إغلاق الجهاز قد يؤخر المحاكاة/heartbeat ويتسبب في انتقال الاستضافة. المغادرة تغلق القنوات وRTCPeerConnections، توقف المؤقتات والمستمعين، وتزيل presence والإشارات الخاصة بالجهاز. `MultiplayerClient.close()` يعادل leave، و`pagehide` يغلق الجلسة أيضاً. لا نسجّل خروج Auth عند إغلاق قناة لأن تبويبات أخرى قد تشارك نفس مستخدم Firebase.

## ما الذي يصل إلى Firebase؟

```text
rooms/{room}/presence/{auth.uid}/{peerId}
rooms/{room}/presence/_lease
rooms/{room}/offers/{recipientPeerId}/{senderPeerId}
rooms/{room}/answers/{recipientPeerId}/{senderPeerId}
rooms/{room}/candidates/{recipientPeerId}/{senderPeerId}/{candidateKey}
```

Presence يحتوي ملف اللاعب، الفريق، `joinedAt`، `seenAt`، الجاهزية وراية creator. تقسيم UID/peerId يسمح بتبويبات متعددة لنفس المستخدم دون أن تمسح إحداها حضور الأخرى. `_lease` هو metadata للإشارات فقط: المضيف، UID، epoch، انتهاء lease، انتهاء الغرفة ومرحلة الجولة. **لا تُكتب مواقع الديدان أو الطعام أو النقاط أو أحداث المباراة إلى RTDB.** مسارات `state` و`score` وأي حقول غير معروفة مرفوضة.

لا توجد قراءة لقائمة الغرف أو جذر قاعدة البيانات. يتم التسجيل الأولي لمستخدم مصادق يمتلك رمز الغرفة، ثم يمكنه قراءة حضور **غرفته فقط** وقراءة الإشارات الموجهة لأجهزته. كل جهاز يكتب presence الخاص به فقط؛ لا يستطيع تغيير joinedAt/team/owner لجهاز آخر. لا يكتب offers إلا المضيف الحالي، وanswers يجب أن تتجه للمضيف؛ candidates محصورة باتصالات المضيف. يتم التحقق من مالك المرسل/المتلقي، epoch، حجم SDP/ICE وTTL. يمكن للمشارك حذف سجل حضور انتهت صلاحيته دون تغييره.

**رمز الدعوة هو capability للانضمام، وليس هوية ranked أو دعوة مرتبطة بحساب معين.** أي مستخدم مصادق يعرف الرمز يمكنه الانضمام ورؤية presence للغرفة. لا توفر anonymous auth ولا هذه القواعد rate-limiting كاملاً أو مقاومة Sybil/DDoS. لا تشارك الدعوة علناً إذا أردت غرفة خاصة، وراقب حدود الاستخدام؛ App Check/خادم دعوات مصادق يمكن إضافتهما لتقليل الإساءة.

## انتخاب المضيف ومنع split-brain

منشئ الغرفة هو المضيف الأول. بعد انتهاء lease، تختار الأجهزة الصادقة المشارك النشط ذي **joinedAt الأصغر، ثم peerId الأصغر بمقارنة bytewise**. لا تستخدم القرعة أو `Math.random()` في الانتخابات. معرف الجهاز ورمز الغرفة فقط يُولدان بـ `crypto.getRandomValues()`.

يجدّد المضيف lease مدته **8 ثوانٍ** كل **ثانيتين** عبر RTDB `runTransaction(..., { applyLocally: false })`. takeover يزيد epoch، وتمنع القواعد سرقة lease حيّ أو تجديد epoch قديم. انتهاء الحضور **20 ثانية**. إذا تأخر `onDisconnect`، لا يحتسب المضيف صاحب lease المنتهي كناجٍ إلا إذا أرسل heartbeat حضور جديداً بعد انتهاء lease؛ بذلك لا يعطل انتقال المضيف بمجرد بقاء سجل قديم.

كل رسالة قناة تحمل epoch. تتوقف سلطة المضيف عند فقد اتصال RTDB أو قبل انتهاء lease بثانية، ويرفض العميل snapshots من جهاز ليس المضيف صاحب lease الحالي. تستخدم الطوابع الزمنية serverTimestamp و`.info/serverTimeOffset`؛ تنصح Firebase بتسجيل onDisconnect **قبل** كتابة presence [2]. Transactions تمنع CAS المتنافسة من الكتابة فوق فائز أحدث [3].

هذه **حماية بأفضل جهد للأجهزة المتعاونة** وليست consensus ضد عميل خبيث: لا تستطيع قواعد RTDB ترتيب عدد اعتباطي من joinedAt/peerId للتحقق من أحقية كل مرشح، ولا تستطيع إيقاف نسخة متصفح معدلة عن الغش. يوجد هامش أخطاء ساعة/شبكة وزمن نقل؛ تأخير ICE قد يضيف ثواني أخرى بعد انتخاب المضيف. سلطة الخادم هي الخيار الأقوى أمنياً.

## المحاكاة والبروتوكول ونقل الجولة

`src/net/p2p.ts` هو plug-in يحافظ على callbacks `OnlineSnapshot/onMatchEnd` المستعملة في `MultiplayerClient`. يستخدم المضيف `PeerSimulation` وواجهة `AuthoritativePeerSimulation`، اللذين يعيدان استخدام **نفس `server/match.mjs`** بدلاً من تشغيل Sim المحلي أو bots. تعمل المحاكاة عند 20Hz ويرسل المضيف snapshots/events عند نحو 10Hz. تستقبل Game وNetworkSim نفس شكل البيانات والتنعيم والنتائج؛ لا تُحفظ النتائج الأونلاين في سجلات/عملات اللعب المحلي.

الرسالة العادية الوحيدة التي تغير المحاكاة من العميل هي control: `targetAngle`, `boost`, `seq`. ترتبط بهوية الجهاز الذي أنشأ الاتصال، لا بحقل playerId من المرسل. تُرفض positions/scores والحقول الإضافية والقيم غير المحدودة، وتطبق Match تحديد معدل المدخلات وتسلسلها. توجد رسائل ping/pong وlobby وnotice. القناة reliable/ordered وتحمل snapshots ذات أحداث ذات IDs للتخلص من التكرار. تُقسّم الرسائل الكبيرة إلى أجزاء أقل من 16KiB، مع حدود لإعادة التجميع وTTL/backpressure حتى لا يعتمد النقل على سماح SCTP برسالة ضخمة واحدة.

عند migration يحتفظ كل جهاز بآخر snapshot صالح. يحاول المضيف الجديد استعادته، أو يطلب **نقلاً استثنائياً للنسخة المخبأة خلال نافذة migration فقط** من أقرانه. هذا ليس API لتحديث مواقع/نقاط العميل أثناء المباراة: لا يقبل المضيف transfer بعد انتهاء النافذة. تُحفظ الأجسام والطعام والنقاط والقتل والتوقيت/المرحلة وspawn/respawn/input/event sequences.

الاستعادة **ليست deterministic replay كاملاً**: public snapshot لا يتضمن حالة RNG أو steering intent أو جزء تكلفة boost الداخلي. يعاد seed الطعام المستقبلي ويُلغى boost/steering المعلق ويبدأ من angle الحالي. تتوقف ساعة الجولة أثناء فقد المضيف. إذا لم تتوفر نسخة صالحة خلال نافذة تصل إلى **10 ثوانٍ**، تبدأ جولة جديدة ويظهر إشعار عربي/إنجليزي صريح بأن نقاط الجولة السابقة صُفرت. `SnapshotStream` يعيد ضبط stream عند epoch جديد حتى لا يرفض NetworkSim الجولة الجديدة بسبب seq أقل، و`onResync` يعيد تهيئة العرض.

## TTL وحدود الخدمة المجانية

للإشارات صلاحية **60 ثانية**، للحضور **20 ثانية**، ولرمز الغرفة **24 ساعة**. `onDisconnect` يزيل حضور/إشارات الجهاز، وleave ينظف طرفي اتصالاته ويحرر lease بـ CAS دون حذف lease لمضيف لاحق. تجمع الأجهزة المتصلة السجلات القديمة المسموح حذفها وتتجاهل البيانات المنتهية دائماً. **RTDB لا يوفر حذف TTL تلقائياً هنا**: قد تبقى metadata صغيرة لـ lease أو إشارات يتيمة إن اختفت جميع الأجهزة قبل تنظيفها. نظف الغرف المنتهية من Console/Admin عند الحاجة؛ لم تُنشر Cloud Function أو cron مدفوعة تلقائياً.

بحسب أسعار Firebase الرسمية وقت كتابة هذا الدليل، Spark يوفر لـ RTDB **100 اتصال متزامن، 1 GB تخزين و10 GB تنزيل شهرياً** [4]. هذا حد للمشروع/قاعدة البيانات، لا لكل غرفة. لكل متصفح اتصال RTDB، ولا تُرسل snapshots اللعبة إليه لتقليل تنزيل الإشارات. حسابات Anonymous لها حدود signup/استخدام وقد تتغير السياسات. ليس الوضع المجاني خدمة غير محدودة؛ راجع Console/الأسعار قبل نشره على نطاق واسع، ولا تفعّل Blaze دون فهم الفوترة.

STUN الافتراضي `stun:stun.l.google.com:19302` لا ينقل بيانات اللعبة ولا يضمن الاتصال عبر كل NAT. يمكن تغيير `VITE_PEER_STUN_URLS` إلى روابط STUN فعلية مفصولة بفواصل. **لا يتضمن المستودع TURN مجاني مضموناً**؛ بعض الشبكات المؤسسية أو symmetric NAT قد تمنع P2P حتى مع Firebase صحيح. استخدم شبكة أخرى أو وضع الخادم. يمكن تزويد `RTCIceServer` ببيانات TURN مؤقتة من خدمة مصادقة مستقبلية، دون نشر سر طويل الصلاحية في JavaScript.

## التحقق وما لم يُختبر حياً

```sh
pnpm typecheck
pnpm test
pnpm multiplayer:test
pnpm build
git diff --check
```

اختبارات `tests/p2p.test.ts` pure ولا تتصل بشبكة خارجية: انتخابات، CAS proposals، epoch/lease failover، رفض positions/scores، التجميع، نقل/استعادة snapshot وتوافق NetworkSim. اختبارات WebSocket الأصلية محفوظة وتعمل مستقلة عن Firebase.

يوجد فحص إضافي اختياري للقواعد على **emulator محلي فقط**، بلا مشروع منشور أو credentials. يتطلب Java 21 وFirebase CLI؛ أول تشغيل قد ينزل emulator/CLI، لكن الفحوص نفسها تصل إلى localhost فقط:

```sh
pnpm dlx firebase-tools emulators:exec --project demo-spaceworm-test --only database "node scripts/test-firebase-rules.mjs"
```

يتحقق من membership ورفض قراءة غرف أخرى/تعداد الغرف، anonymous requirement، onDisconnect قبل إنشاء حضور، ملكية presence/signaling، رفض authoritative state/score، lease CAS/failover وepoch القديم. `demo-spaceworm-test` هنا اسم **اختبار emulator فقط**، وليس config للإنتاج. لا تُنشَر القواعد بهذا الأمر.

**لم تختبر هذه المهمة اتصال عدة متصفحات عبر مشروع Firebase حقيقي أو شبكات NAT مختلفة** لعدم توفر مشروع/إعدادات مصرح بها. يلزم smoke test بعد إدخال إعدادات مشروعك: جهازان بفريقين، ready/start، steering/boost، ثم إغلاق المضيف أثناء الجولة والتحقق من النقل/إشعار resync، وأخيراً leave ونظافة RTDB. لا تدعي النسخة وجود خدمة Firebase عامة عاملة قبل ذلك.

## References

[1]: https://firebase.google.com/docs/auth/web/anonymous-auth "Firebase anonymous authentication for web"
[2]: https://firebase.google.com/docs/database/web/offline-capabilities "Firebase web presence, onDisconnect and server time"
[3]: https://firebase.google.com/docs/database/web/read-and-write "Firebase web writes and transactions"
[4]: https://firebase.google.com/pricing "Firebase Spark pricing and quotas"
