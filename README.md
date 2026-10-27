# The Ride — tijdelijke online ChatGPT-proef

Dit pakket bevat uitsluitend generieke proefcode onder de MIT-licentie en de bijbehorende broncode. Het bevat geen volledige trainingsapp, .env-bestanden, databases, gezondheidsgegevens, API-sleutels of bestaande inlogsessies. De HTTP-proef is beveiligd met een apart, op Render gegenereerd toegangswachtwoord.

De lokale abonnementstest is voor één account geslaagd. Deze online uitvoering is nog een proef: publicatie op Render, ontvangst van toestemming, OpenAI-toelating voor deze uitvoering en smartphonegebruik moeten nog live worden bevestigd. Deze generieke open-source proef mag niet als algemene toestemming voor een commerciële of andere hosted app worden gelezen.

## 1. GitHub-account en upload

1. Maak een gratis account op https://github.com/signup en bevestig je e-mailadres. Log zelf in; deel nooit je wachtwoord of token in de chat.
2. Maak via https://github.com/new een repository met de naam `the-ride-online-probe`.
3. Voor deze open-source proef kan **Public** worden gekozen: uitsluitend de generieke code in dit pakket wordt dan zichtbaar. Je volledige persoonlijke app blijft buiten deze repository. Wil je deze proefcode niet openbaar maken, stop dan vóór publicatie; de toepasselijke privé/hosted toegang moet dan apart worden geverifieerd.
4. Laat ‘Add README’, ‘Add .gitignore’ en een extra licentie uit: deze zitten al in het pakket. Kies Create repository.
5. Kies ‘uploading an existing file’ of Add file → Upload files. Pak de ZIP lokaal uit. Upload de **inhoud** van de map `online-probe-bundle`, inclusief `source/` en `licenses/`. Upload niet de volledige oorspronkelijke projectmap en niet alleen het ZIP-bestand.
6. Controleer dat `render.yaml`, `server.mjs`, `package.json`, `package-lock.json` en deze README in de hoofdmap staan. Commit de bestanden met bijvoorbeeld ‘Add isolated online probe’.

## 2. Render: gebruik het meegeleverde Free-blueprint

1. Open je Render-dashboard. Kies **New → Blueprint**.
2. Verbind je GitHub-account als Render dat vraagt. Geef Render alleen toegang tot deze proefrepository en selecteer `the-ride-online-probe`.
3. Gebruik `render.yaml` in de hoofdmap. Controleer vóór Deploy dat er precies één **Free web service** wordt voorgesteld, zonder database, disk of andere betaalde dienst. De bestandsnaam bevat `plan: free`.
4. Geef de Blueprint een naam en start de deploy. Het pakket heeft geen runtime-npm-afhankelijkheden: de controleerbare `server.mjs` is vooraf gebundeld.
5. Wacht tot de web service **Live** is. Je krijgt een eigen `https://…onrender.com`-adres. Het adres mag je aan je begeleider doorgeven; geen environmentwaarden of koppelcodes.
6. Render stelt automatisch `RENDER_EXTERNAL_URL` in. Het blueprint genereert privé `PROBE_ACCESS_PASSWORD` en `PROBE_HOST_SEED`. Laat die waarden op Render staan; voeg geen OpenAI API-key of ChatGPT-token toe.
7. Open in de web service **Environment**, bekijk `PROBE_ACCESS_PASSWORD` en gebruik het alleen in je eigen online proefpagina. Bewaar het veilig zodat je het ook op je telefoon kunt invullen. Deel het niet in de chat. `PROBE_HOST_SEED` blijft ongewijzigd zodat het server-ID stabiel blijft.

Als je alleen New → Web Service gebruikt, worden blueprintwaarden niet vanzelf toegepast. Gebruik daarom de Blueprint-route hierboven. Wordt een betaald plan of betaalmethode vereist, maak dan geen betaald abonnement aan; laat de exacte niet-geheime melding controleren.

## 3. Tijdelijke ChatGPT-toestemming overbrengen

1. Open de online proef op je pc en log in met `PROBE_ACCESS_PASSWORD`.
2. Kies **Nieuwe koppelcode maken**. De code is vijf minuten geldig en eenmalig voor import. Deel hem niet in de chat.
3. Laat op de pc de bijgewerkte lokale proef draaien: `npm run chatgpt:probe`. Open http://127.0.0.1:4319/#online.
4. Vul bij **Online proef koppelen** je exacte Render-hoofdadres en de koppelcode in. Controleer dat dit jouw eigen dienst is. Bevestig dat de tijdelijke ChatGPT-toestemming via HTTPS rechtstreeks naar dat adres mag.
5. Klik **Inloggen en mijn online proef koppelen**. Log zelf in bij OpenAI en bekijk de toestemming. Het verzoek gebruikt het ID van de online proef; de callback blijft op je pc. Dit is een aparte login voor deze overdracht.
6. Na afronding stuurt het lokale proces alleen de tijdelijke access token, ondertekende identiteit en registratiegegevens rechtstreeks naar de geauthenticeerde HTTPS-import. Geen token wordt in het browserformulier of een URL weergegeven, in de chat geplakt of op schijf bewaard. Er is geen refresh-tokenoverdracht.
7. De online server controleert de identiteit opnieuw en haalt de modelcatalogus op. Dit voert nog geen AI-generatie uit. De overdracht is niet geslaagd voordat de lokale pagina dit bevestigt.

## 4. De echte pc-uitproef

1. Open de Render-HTTPS-link op je smartphone en log in met het toegangswachtwoord. Er is geen directe verbinding met je pc nodig.
2. Controleer dat de online pagina **TIJDELIJK VERBONDEN** toont. Doe dit binnen tien minuten na de overdracht.
3. Zet wifi op de telefoon uit en gebruik mobiel internet. Zet je pc volledig uit.
4. Kies een model. Bevestig één vaste testzin en vink desgewenst aan dat je pc uitstaat en je mobiel internet gebruikt. Dat laatste is jouw bevestiging, niet een meting door de server.
5. Klik één keer op **Test op de online server**. De tekst is uitsluitend `Reply with exactly: The Ride connection works.`. Elke aanvraag telt mee binnen je abonnementsruimte.
6. Alleen **ONLINE TEST GESLAAGD** met volledige afronding en het proces-ID telt als resultaat. Geef die status of de veilige diagnose door, zonder wachtwoord, code of token.
7. Wis via **Online testsessie wissen** de tijdelijke toestemming. Intrekken bij OpenAI gebeurt apart in je ChatGPT-instellingen.

## Tijdelijk betekent tijdelijk

- Alleen procesgeheugen, maximaal tien minuten; geen permanente AI-coach, tokenrefresh of database. Maximaal drie expliciete aanvragen per koppeling, met een cooldown van één minuut.
- Een Render-herstart of slaapstand wist de koppeling en de browserlogins. Render Free kan na vijftien minuten zonder verkeer inslapen. De volgende aanvraag kan de dienst wekken, maar wist eerder geheugen niet terug. Koppel dan opnieuw met je pc aan.
- De eerste pc-uitproef bewijst dat een aanvraag op een afzonderlijke server kan lopen. Zij bewijst geen blijvend gratis beschikbaarheid, duurzame veilige tokensopslag, periodieke Garmin-import of geteste coachkwaliteit.
- De server bindt op Render aan `0.0.0.0:$PORT`. Een HTTPS-origin, sterk toegangswachtwoord en stabiele host-seed zijn verplicht. Cookies zijn Secure/HttpOnly/SameSite=Strict; formulieracties controleren Origin en CSRF. Geen CORS, geen tokens in logs of browsercode.

## Bron en build

De exacte TypeScriptbron staat in `source/`. `server.mjs` is de meegeleverde ESM-build voor Node 24. `FILES.sha256.json` legt de SHA-256 van de verpakte bestanden vast. Opnieuw bouwen kan met Node 24 en esbuild 0.28.2 vanuit de bron:

```
npx --yes esbuild@0.28.2 source/scripts/online-probe.ts --bundle --platform=node --format=esm --target=node24 --outfile=server.mjs
```

Bij opnieuw bouwen moeten jose 6.2.13 en zod 4.6.7 beschikbaar zijn; deze dependencies zitten al gebundeld in de meegeleverde build. De licenties staan in `licenses/`. Deze README is geen uitnodiging om credentials in een repository of shellcommando te plaatsen.

Officiële referenties:

- https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms
- https://developers.openai.com/siwc/token-sharing-open-source
- https://render.com/docs/free
- https://render.com/docs/blueprint-spec
