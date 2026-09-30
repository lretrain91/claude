# Beat Spotify

Deux outils dans le navigateur, construits sur le même moteur d'écoute :

- **Musicalité** (`musicalite/`) : appli pour téléphone qui écoute la musique au micro et
  décrit, pour le West Coast Swing, le tempo, le feeling, les comptes de 8, les phrases,
  les tags et la micro-musicalité.
- **Le jeu de rythme** (`index.html`) : notes générées à partir de ta musique Spotify.

## Musicalité

Un résumé simple et visuel de la construction d'un morceau.

Ouvre `musicalite/` sur ton téléphone, touche **Écouter** et mets ta musique à côté
(ou analyse un fichier audio). Le micro demande une page en `https://` (GitHub Pages) :
https://lretrain91.github.io/claude/musicalite/

- **La carte du morceau**, dessinée au fil de l'écoute : un bâton par 8 temps
  (hauteur = énergie, couleur = section), les phrases (4 × 8 temps) séparées par un espace,
  une ligne toutes les 4 phrases, et les moments clés marqués au-dessus
  (‖ break, ▲ drop, ↗ montée, T tag, ~ basse coupée, ● hit).
- **La forme** en lettres, par exemple `A B A B C B` : les sections qui se ressemblent
  reçoivent la même lettre.
- En direct : tempo, feeling (swing ou droit), compte de 1 à 8, position dans la phrase.
  « Taper le 1 » et « Début de phrase » recalent les comptes si besoin.
- Bilan : la carte s'enregistre en image, le résumé se copie en texte, et le détail
  complet se télécharge en JSON.

Les sections, comptes et moments sont estimés à partir de l'énergie du son dans
4 bandes de fréquence : fiables sur des musiques au rythme marqué, à vérifier à l'oreille.

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
- `musicalite/` : interface de l'appli Musicalité (web app installable), dont `map.js` pour la carte.

## Changer les titres

La liste est dans `tracks.js` (titre, artiste, pochette, URL de l'extrait).
