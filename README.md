# The Ride — blijvende persoonlijke ChatGPT-koppeling

Dit is generieke open-source koppelcode, geen volledige trainingsapp. Alleen een vaste testzin wordt verstuurd. De eerdere tienminutenproef is geslaagd op de smartphone met pc uit. Deze versie voegt versleutelde databaseopslag en tokenvernieuwing toe en moet nog echt worden getest.

De eigenaar heeft op 27 oktober 2026 expliciet ingestemd met overdracht van vernieuwbare OAuth-toestemming naar **https://the-ride-online-probe.onrender.com** en versleutelde opslag in het eigen Supabase-project. De code accepteert uitsluitend deze bestemming.

## 1. Maak een gratis Supabase-project

1. Open https://supabase.com/dashboard en maak een account of log in.
2. Kies New project en een organisatie op het **Free**-plan. Maak geen upgrade en voeg geen betaalde extra's toe.
3. Kies een Europese regio, bijvoorbeeld Frankfurt. Kies een sterk databasewachtwoord en bewaar dat privé.
4. Wacht tot het project klaar is. Open **SQL Editor**, kies rechtsboven de **Postgres/Primary Database** als bron (niet **Logs**), maak een query en plak de inhoud van `database.sql` uit dit pakket. Klik **Run**. Dit maakt lege private tabellen; het bevat geen tokens of trainingsgegevens.
5. Open **Connect** in Supabase. Kies **Session pooler** en kopieer de PostgreSQL-URI naar je eigen veilige configuratie. Vervang alleen de wachtwoordplaceholder door je databasewachtwoord; speciale tekens moeten correct URL-gecodeerd zijn. Gebruik de exacte door Supabase getoonde host, poort en gebruikersnaam. Deel de URI niet in chat of GitHub.

Voor deze geïsoleerde koppeling zijn Supabase Auth, Storage en een service-role API-key nog niet nodig. De volledige trainingsapp gebruikt die later wel.

### Bij ‘Only singular query allowed’

Bij de combinatie met `sql parser error: Expected: an SQL statement, found: DO` eerst de querybron controleren. Bij deze installatie toonde de screenshot de juiste SQL Editor met rechtsboven **Logs** geselecteerd en de banner **Logs now run on a ClickHouse-backed engine**. Na wisselen naar de Postgres-database bevestigde de eigenaar **Success. No rows returned**. Dezelfde editor kan dus verschillende querybronnen gebruiken. `DO` is geldige PostgreSQL-syntax; verander het databaseschema niet om een ClickHouse-parser tevreden te stellen.

De aanvullende `deploy/online-connect/install-single-query.sql` in het lokale volledige project is ook bruikbaar op de Postgres-bron. Dit bestand staat naast deze handleiding; het oorspronkelijke ZIP-pakket bevat nog de gewone `database.sql`. Vervang de volledige editorinhoud door de SQL-code, niet het bestandspad, en klik Run. Gebruik hiervoor niet het invoerveld van de AI-assistent of een tabel-filter.

De variant bundelt dezelfde migrations 001 en 004 in één PostgreSQL `DO`-opdracht. Beide uitvoeren of herhalen verwijdert geen bestaande gegevens. De variant is via de single-statement query-interface getest op installatie, RLS, private verbindingsrechten en behoud van bestaande verbindingsrecords. Hij verandert het schema niet en voegt geen publieke toegang toe. Regenereren: `node scripts/build-single-query-install.mjs`.

## 2. Bereid de bestaande Render-service voor

Open https://dashboard.render.com, selecteer **the-ride-online-probe** en open **Environment**. Voeg toe:

- `DATABASE_URL`: de complete eigen Supabase Session-pooler-URI met wachtwoord, volgens de TLS-instructies bij Connect. Schakel certificaatcontrole niet uit.
- `APP_ENCRYPTION_KEY`: 32 willekeurige bytes als base64. Genereer lokaal; kopieer rechtstreeks naar Render en bewaar een privéback-up. Deze sleutel mag nooit in de repository of chat komen.

Een sleutel maak je bijvoorbeeld in je eigen PowerShell-terminal met:

```powershell
$rideRandomKey = [byte[]]::new(32)
$rideKeyGenerator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rideKeyGenerator.GetBytes($rideRandomKey)
$rideKeyGenerator.Dispose()
[Convert]::ToBase64String($rideRandomKey) | Set-Clipboard
```

Plak rechtstreeks in Render. Overschrijf geen bestaande `APP_ENCRYPTION_KEY` als er al versleutelde gegevens zijn. Maak een privéback-up van de sleutel: zonder die sleutel zijn opgeslagen tokens onleesbaar.

Behoud `PROBE_ACCESS_PASSWORD`: dit blijft hetzelfde toegangswachtwoord. De oude `PROBE_HOST_SEED` mag blijven staan; de nieuwe stabiele host-ID wordt in de database aangemaakt. Render stelt `RENDER_EXTERNAL_URL` en `PORT` zelf in.

## 3. Werk dezelfde GitHub-repository bij

Werk de **bestaande** repository `Streanelretep/the-ride-online-probe` bij met dit pakket. De hoofdmap moet de nieuwe `server.mjs`, `package.json`, `package-lock.json` en `render.yaml` bevatten. Bewaar ook `source/`, `licenses/`, `database.sql`, de README en de MIT-licentie met hun mappenstructuur. Upload nooit `.env.local`, tokens of de volledige trainingsapp.

Gebruik de bestaande gekoppelde Render-service; maak geen tweede webservice of Blueprint aan. Controleer bij de update dat het plan **Free** blijft. De build is `npm ci --omit=dev`, de startopdracht `npm start`. Wacht tot de bestaande service Live is. De pagina heet nu **Blijvende ChatGPT-koppeling**.

Als de start mislukt, controleer migrations, de twee nieuwe environmentwaarden en de databaseverbinding. Logs tonen alleen veilige configuratiemeldingen. Plak environmentwaarden nooit in een foutmelding of chat.

### Test eerst database en encryptiesleutel

Versie 0.2.1 doet vóór opstarten één controle op de echte serverconfiguratie. Deze opent de database, controleert de tabellen, versleutelt een willekeurige synthetische tekst, schrijft die in een transactie, leest en ontsleutelt het testrecord en draait de transactie terug. Er blijft geen testrecord staan. De gebruikte sequence kan wel een nummer opschuiven. Er wordt geen ChatGPT- of Garmin-aanvraag gedaan en er wordt geen echte toestemming gemaakt of vervangen.

Open na de update op de bestaande Render-service **Logs** (niet de Supabase Logs-querybron). Verwacht:

```text
CONNECT_STORAGE_OK: database lezen/schrijven en encryptie gecontroleerd; testrecord teruggedraaid.
```

Dit bewijst de actuele databaseverbinding, lees-/schrijfrechten voor de controle en een volledige encryptierondgang met APP_ENCRYPTION_KEY. Als er nog geen echte toestemming bestaat, bewijst dit niet dat die sleutel eerder opgeslagen tokens kan lezen. Bestaan die wel, dan controleert dezelfde test hun ontsleuteling en verschijnt bovendien `CONNECT_EXISTING_KEY_OK`. Een verkeerde sleutel stopt de server zonder bestaande tokens te wissen. Een testfout meldt `CONNECT_STORAGE_FAILED` met uitsluitend een vaste code:

| Code | Wat controleren |
| --- | --- |
| `ENCRYPTION_KEY_INVALID` | APP_ENCRYPTION_KEY moet 32 bytes in base64 zijn |
| `DATABASE_CONNECT_FAILED` | DATABASE_URL, nieuw wachtwoord, Session pooler, actief Supabase-project en TLS |
| `DATABASE_TRANSACTION_FAILED` | Databaseverbinding of transactierechten |
| `DATABASE_SCHEMA_MISSING` | SQL-installatie en leesrechten op de verwachte tabellen |
| `DATABASE_WRITE_FAILED` | Schrijfrechten, eigenaarrecord uit de installatie en beschikbare databaseruimte |
| `DATABASE_READBACK_FAILED` | Teruglezen/ontsleutelen mislukt; deel alleen deze code |
| `STORED_CREDENTIAL_KEY_MISMATCH` | Bestaande toestemming past niet bij de sleutel of is beschadigd; herstel de juiste sleutel, wis geen tokens op goed geluk |
| `DATABASE_CLEANUP_FAILED` | Geen succes vastgesteld; de getroffen poolverbinding wordt weggegooid |

`CONNECT_SETUP_REQUIRED` verschijnt vóór deze test als de verplichte variabelen ontbreken of de sleutelgrootte onjuist is. Een gewone `/healthz`-respons van de oude proef test deze variabelen niet. De logcode bewijst nog geen herstartbestendige echte toestemming, OpenAI-refresh of coachwerking: daarvoor volgt apart de nieuwe koppeling en smartphoneproef hieronder.

## 4. Koppel met nieuwe toestemming

1. Open https://the-ride-online-probe.onrender.com en log in met hetzelfde toegangswachtwoord.
2. Bevestig dat je vernieuwbare toegang wilt bewaren en klik **Nieuwe koppelcode maken**.
3. Start in de lokale volledige projectmap `npm run chatgpt:connect` en open **http://127.0.0.1:4320**.
4. Plak de code alleen daar, bevestig de overdracht en kies **Continue with ChatGPT**.
5. Log zelf in bij OpenAI en bekijk de toestemming voor je plan en vernieuwbare toegang. Gebruik dezelfde ChatGPT-accountregistratie bij later opnieuw aanmelden.
6. Wacht tot de aanmeldhulp meldt dat de toestemming versleuteld is opgeslagen. Tokens worden rechtstreeks via HTTPS naar de goedgekeurde server gestuurd en blijven niet op de lokale schijf.
7. Ververs de online pagina. Die moet **TOESTEMMING OPGESLAGEN** tonen. Klik **Mijn modellen ophalen**, kies een model en bevestig één test.

De oude proef op poort 4319 hoort bij het vorige protocol. Haar codes en tijdelijke tokens worden niet omgezet in vernieuwbare toestemming.

## 5. Smartphone- en herstartproef

1. Open dezelfde HTTPS-link op je smartphone en log zo nodig in.
2. Schakel wifi uit, gebruik mobiel internet en zet je pc volledig uit.
3. Haal modellen op en voer één test uit. Wacht op **ONLINE TEST GESLAAGD**.
4. Herstart de **bestaande** service via Render. Log opnieuw in op de telefoon, haal modellen op en test opnieuw. Het proces-ID moet veranderen terwijl de opgeslagen toestemming beschikbaar blijft.
5. Voer bij later gebruik na het vervallen van het toegangstoken nog één test uit. De server hoort de toegang zelf te vernieuwen. Pas deze echte proef bewijst werkende tokenrotatie voor dit account. Wijzig voor de proef geen opgeslagen tokens of databasetijden.

Er geldt een wachttijd van één minuut tussen AI-tests. Er is geen automatische herhaling en geen terugval op een betaalde API-key. Het vakje 'pc uit' is je eigen bevestiging; de server meet je pc niet.

## Beperkingen en opruimen

Tokens worden AES-256-GCM versleuteld in de database bewaard, met de sleutel apart bij Render. De server kan ze voor OpenAI-verzoeken tijdelijk ontsleutelen. Bescherm beide accounts. Gebruik blijft binnen je bestaande ChatGPT-toestemming en limieten; er is geen afzonderlijk onbeperkt AI-budget.

Render Free kan slapen, en Supabase Free heeft quota en kan bij weinig activiteit pauzeren. Dit pakket houdt diensten niet kunstmatig wakker. Een lang ongebruikte of ingetrokken toestemming kan opnieuw aanmelden op een pc vereisen. Rechtstreeks opnieuw aanmelden op alleen een smartphone is nog niet beschikbaar.

**ChatGPT loskoppelen** verwijdert tokens uit de database en vraagt intrekking bij OpenAI. Als die intrekking niet bevestigd is, rond je die af in ChatGPT-instellingen. Alleen uitloggen op de webpagina verwijdert de serverkoppeling niet. Een lopend netwerkverzoek kan niet worden teruggehaald; verouderde resultaten worden niet als nieuwe verbinding opgeslagen.

Bronnen: [OpenAI self-hosted VMs](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms), [sessies en refresh](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions), [Render Free](https://render.com/docs/free), [Supabase Free](https://supabase.com/pricing).

## Pakket en broncode

`server.mjs` bundelt de generieke koppelcode; `pg` wordt met de vastgepinde lockfile geïnstalleerd. De broncode staat onder `source/`; bundel met esbuild 0.28.2 voor Node 24, met `pg` als externe dependency. De volledige trainingsapp, persoonlijke configuratie en tokens zijn niet inbegrepen. `FILES.sha256.json` inventariseert de distributiebestanden.
