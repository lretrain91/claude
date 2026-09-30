# Beat Spotify

Petit jeu de rythme dans le navigateur, généré à partir des titres écoutés sur Spotify.

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

## Changer les titres

La liste est dans `tracks.js` (titre, artiste, pochette, URL de l'extrait).
