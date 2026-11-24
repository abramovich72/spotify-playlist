# Playlist Studio

אפליקציית Web לטעינת רשימת שירים מקובץ Excel, CSV או TXT ולייבוא התאמות ל-Spotify.

## דרישות

- Node.js 22.18 ומעלה
- חשבון Spotify ואפליקציה שנרשמה ב-[Spotify Developer Dashboard](https://developer.spotify.com/dashboard)

## הגדרת הגישה ל-Spotify

1. היכנסו ל-[Spotify Developer Dashboard](https://developer.spotify.com/dashboard) וצרו אפליקציה חדשה.
2. פתחו את הגדרות האפליקציה, ובשדה **Redirect URIs** הוסיפו בדיוק:

   ```text
   http://127.0.0.1:3000/api/auth/callback
   ```

   שמרו את ההגדרה.
3. העתיקו מהגדרות האפליקציה את **Client ID** ואת **Client Secret** אל `.env.local` לפי ההנחיות בהמשך. ה-Client Secret הוא סודי: אין לפרסם או לשלוח אותו.
4. במצב **Development Mode**, בעל האפליקציה צריך חשבון Spotify Premium פעיל, ועד חמישה חשבונות יכולים להשתמש בה. הוסיפו את כתובת האימייל של חשבון Spotify שלכם תחת **Settings → Users Management**. פרטים נוספים: [Quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes).

## הפעלה מקומית

1. התקינו את התלויות:

   ```powershell
   npm install
   ```

2. העתיקו את `.env.example` לקובץ `.env.local` והגדירו את פרטי Spotify:

   ```powershell
   Copy-Item .env.example .env.local
   ```

   הגדירו את `SPOTIFY_CLIENT_ID` ואת `SPOTIFY_CLIENT_SECRET` מתוך פרטי האפליקציה ב-Spotify. הגדירו גם `SESSION_PASSWORD` למחרוזת אקראית באורך 32 תווים לפחות. אפשר ליצור אחת באמצעות:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
   ```

3. הוסיפו ב-Spotify Developer Dashboard את כתובת ההפניה המדויקת:

   ```text
   http://127.0.0.1:3000/api/auth/callback
   ```

   ודאו שהכתובת הזו זהה לערך של `SPOTIFY_REDIRECT_URI` בקובץ `.env.local`.
   Spotify אינו מקבל `localhost` ככתובת Redirect. פתחו את האפליקציה דרך `http://127.0.0.1:3000` כדי שעוגיית ההתחברות תישאר באותו host.

4. הפעילו את האפליקציה:

   ```powershell
   npm run dev
   ```

   פתחו את [http://127.0.0.1:3000](http://127.0.0.1:3000).
   ב-Windows אפשר גם להפעיל בלחיצה כפולה על [run.bat](./run.bat). חלון השרת יישאר פתוח; לחצו `Ctrl+C` כדי לעצור אותו.

## מבנה הקבצים הנתמכים

- **Excel (`.xlsx`) ו-CSV:** גיליון/טבלה עם כותרות `Artist` ו-`Track`. הכותרות אינן תלויות באותיות גדולות/קטנות.
- **TXT:** שורה אחת לכל שיר בפורמט `Artist - Track`.
- גודל הקובץ המרבי הוא 10 MB, ומספר השירים המרבי הוא 1,000.

במסך בחירת הקובץ מופיע פרומפט שאפשר להעתיק לכלי AI ליצירת רשימת שירים בפורמט TXT. לאחר בחירת קובץ מוצע שם לפלייליסט חדש לפי שם הקובץ; אפשר לערוך אותו.

האפליקציה מחפשת התאמות לפי שם השיר והאמן. התאמה ודאית מסומנת אוטומטית; כשיש כמה גרסאות או רק הצעות קרובות, ההצעה המומלצת הראשונה מסומנת כברירת מחדל, וביצועי Live ידורגו לפני גרסאות אחרות. אפשר לבחור גרסה אחרת או לדלג. אם החיפוש לפי האמן והשיר לא מחזיר תוצאות, מתבצע חיפוש נוסף לפי שם השיר כדי להציג הצעה אפשרית. שירים שלא נמצאו או שנבחר עבורם דילוג לא ייכללו. לא מתבצעת כתיבה ל-Spotify עד לאישור הייבוא. פלייליסט חדש נוצר כפרטי.

בבחירת פלייליסט קיים אפשר להוסיף אליו שירים, או לפתוח את מצב העריכה: לטעון את השירים הנוכחיים, להסיר שירים, לגרור אותם לשינוי הסדר ולהוסיף התאמות מקובץ. לחיצה על שמירה מחליפה את רשימת השירים ב-Spotify ברשימה הערוכה. השמירה זמינה רק לאחר טעינת כל השירים, ופריטים שאינם שירי Spotify רגילים חייבים להיות מוסרים לפני העדכון.

קובץ מיובא נשלח לשרת לצורך עיבוד בזיכרון, ואינו נשמר בדיסק. פרטי OAuth נשארים בצד השרת, וה-session נשמר בעוגיית HTTP-only מוצפנת.

## בדיקות

```powershell
npm test
npm run lint
npm run build
```
