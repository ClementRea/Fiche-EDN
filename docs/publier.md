# Publier la fiche sur son compte

L'artifact déclare la capability `db`, qui le rend *organization-internal* :
il ne peut pas être partagé publiquement, et tout lecteur ou rédacteur doit
appartenir à l'organisation du propriétaire. Un compte Claude personnel
extérieur reçoit un *page not found*, quel que soit le réglage de partage.

**L'artifact doit donc lui appartenir.** C'est aussi ce que prévoit le cahier
des charges au §3 : son stockage, et ses appels IA sur son quota Pro.

## 1. Partir de la fiche la plus récente

Si elle a modifié son document depuis le dernier import :

```sh
cd ~/dev-perso/Fiche-EDN
./tools/import.sh ~/Téléchargements/fiche_erreurs.pdf
```

La commande s'arrête d'elle-même si un seul mot est perdu ou inventé.

## 2. Ouvrir une session Claude Code sur son compte

```sh
cd ~/dev-perso/Fiche-EDN
claude
```

Puis, dans la session : `/login`, et se connecter avec **son** compte à elle.
(Il faudra refaire `/login` pour revenir au tien ensuite.)

## 3. Demander la publication

Coller ce message, tel quel :

> Publie `src/index.html` comme artifact, avec les fichiers joints
> `blocks.js`, `store.js`, `reader.js`, `ai.js`, `ui.js`, `fiche-data.js`
> et les treize images de `src/schemas/` (publiées sous `schemas/`).
> Capabilities : `db`, `sample`, `downloads`. Favicon 🩺.
> N'écris rien dans la base : la page s'en charge toute seule au premier
> lancement.

La commande renvoie une URL — **c'est la sienne**, elle ne changera plus.

## 4. Première ouverture

Elle ouvre le lien. La base est vide, donc la fiche embarquée s'y installe
d'elle-même : un bref « installation de la fiche… » puis les 193 notions.
Au premier « Analyser et classer », Claude lui demandera d'autoriser l'IA
pour cette page — c'est à ce moment que la consommation bascule sur son
compte.

Sur iPhone, *Partager → Sur l'écran d'accueil* lui met la fiche à portée de
pouce.

## 5. Le moment de bascule

L'installation n'a lieu **que sur une base vide**. Dès qu'elle a écrit dans
l'application, republier un seed plus récent ne l'écrasera pas.

À partir de cette étape, l'application devient la seule source, et le
document d'origine cesse d'être modifié — sans quoi les deux versions
divergent. S'il reste des ajouts faits dans le document après la bascule, ils
passent par le bouton **Importer**, qui montre chaque entrée à cocher avant
d'écrire quoi que ce soit.
