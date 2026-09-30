# Beat Spotify

Deux outils dans le navigateur, construits sur le même moteur d'écoute :

- **Musicalité** (`musicalite/`) : appli pour téléphone qui écoute la musique au micro et
  décrit, pour le West Coast Swing, le tempo, le feeling, les comptes de 8, les phrases,
  les tags et la micro-musicalité.
- **Le jeu de rythme** (`index.html`) : notes générées à partir de ta musique Spotify.

## Musicalité

Ouvre `musicalite/` sur ton téléphone, touche **Écouter** et mets ta musique à côté
(Spotify sur une enceinte, un autre téléphone…). Le micro demande une page en `https://` :
active GitHub Pages sur le dépôt, puis ouvre `https://<utilisateur>.github.io/<dépôt>/musicalite/`
et « Ajouter à l'écran d'accueil » pour l'installer comme une appli.

En direct :
- tempo (BPM) et sa catégorie WCS (**lent** < 88, **moyen** 88–108, **rapide** > 108) ;
- **feeling** : swing / shuffle (contretemps vers 2/3 du temps) ou droit (à la moitié) ;
- compte **1 à 8** qui défile en rythme, position dans la phrase (**4 × 8 temps**)
  et « prochaine phrase dans N temps » pour faire tomber tes patterns sur le 1 ;
- liste des événements, chacun placé sur son compte (ex. `P2 · 3/4 · 4&`) :

| Événement | Ce que ça veut dire |
|---|---|
| Nouvelle section | le son change nettement d'un 8-temps à l'autre (couplet → refrain…) |
| Montée | l'énergie monte pendant 3 × 8 temps |
| Break / Reprise | la musique s'arrête presque, puis repart |
| Drop | l'énergie explose après un passage calme ou un break |
| Basse coupée / Retour de la basse | la basse disparaît puis revient |
| Hit | tous les instruments frappent ensemble |
| Accent | un temps nettement plus fort que le groove habituel |
| Syncope | un accent sur le « & » ou à contretemps |
| Fill | roulement sur les temps 7-8, avant la suite |
| Tag | la musique repart après un break ailleurs que sur un 1 : phrase rallongée ou raccourcie ; les comptes se recalent tout seuls et les temps en trop sont notés « Tag · 1…4 » |

Chaque événement est accompagné d'une idée d'interprétation WCS (freeze ou anchor tenu sur
un break, stretch quand la basse est coupée, triple step syncopé sur une syncope…),
désactivable dans les réglages.

« **Taper le 1** » recale les comptes (tape pile sur un 1), « **Début de phrase** » recale
les phrases. En fin d'écoute, le **bilan** donne la structure du morceau (sections, énergie
de chaque 8-temps) et tous les événements, à copier ou télécharger en texte ou en JSON.
Plusieurs morceaux à la suite (playlist) sont séparés automatiquement grâce aux silences.
On peut aussi analyser un fichier audio.

Les comptes et les événements sont des estimations faites à partir de l'énergie du son
dans 4 bandes de fréquence : fiables sur des musiques au rythme marqué, à vérifier à l'oreille.

## Le jeu de rythme

## Jouer

Ouvre `index.html` dans un navigateur (double-clic, ou via GitHub Pages).

- Touches **D F J K** (ou toucher les pistes sur mobile), **Échap** pour quitter.
- 3 difficultés, record sauvegardé par titre.
- **+ Fichier audio** : joue sur n'importe quel MP3/WAV de ton ordinateur (morceau complet).

## Mode live (playlist Spotify en direct)

- **Capturer l'onglet Spotify** (Chrome/Edge sur ordinateur) : ouvre ta playlist sur
  open.spotify.com, lance le live, choisis cet onglet et coche « Partager l'audio ».
  Le jeu coupe le son de l'onglet et le rejoue avec 2,5 s de retard : les notes tombent
  exactement sur les attaques réelles.
- **Micro** : pour l'appli Spotify, un téléphone ou une enceinte. Le jeu mesure le tempo
  et projette chaque attaque sur la mesure suivante (précis sur les musiques régulières).
- Les silences entre deux titres sont détectés : le bilan donne un score par titre.

Le partage d'onglet et le micro demandent une page servie en `https://` (GitHub Pages)
ou ouverte en local.

## Comment les notes sont générées

L'extrait de 30 s du titre (fourni par Spotify) est découpé en 4 bandes de fréquence,
une par piste : basses → D, bas-médiums → F, hauts-médiums → J, aigus → K.
Chaque attaque détectée (pic d'énergie) dans une bande devient une note.

## Code

- `js/engine.js` : pistes, notes, jugement, score.
- `js/analysis.js` : détection des attaques, choix des notes, tempo, capture audio.
- `js/app.js` : menu, mode extraits, mode live.
- `js/musicality.js` : analyse de musicalité (comptes, phrases, événements, bilan).
- `musicalite/` : interface de l'appli Musicalité (web app installable).

## Changer les titres

La liste est dans `tracks.js` (titre, artiste, pochette, URL de l'extrait).
