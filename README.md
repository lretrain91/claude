# Beat Spotify

Petit jeu de rythme dans le navigateur, généré à partir des titres écoutés sur Spotify.

## Jouer

Ouvre `index.html` dans un navigateur (double-clic, ou via GitHub Pages).

- Touches **D F J K** (ou toucher les pistes sur mobile), **Échap** pour quitter.
- 3 difficultés, record sauvegardé par titre.
- **+ Fichier audio** : joue sur n'importe quel MP3/WAV de ton ordinateur (morceau complet).

## Comment les notes sont générées

L'extrait de 30 s du titre (fourni par Spotify) est découpé en 4 bandes de fréquence,
une par piste : basses → D, bas-médiums → F, hauts-médiums → J, aigus → K.
Chaque attaque détectée (pic d'énergie) dans une bande devient une note.

## Changer les titres

La liste est dans `tracks.js` (titre, artiste, pochette, URL de l'extrait).
