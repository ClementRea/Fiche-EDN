# Fiche EDN

Une fiche de révision pour les EDN où l'on note une information **en vrac** —
au clavier, à la voix ou en photographiant une page — et où elle se classe,
se structure et se fusionne toute seule dans la fiche existante.

Publié comme Artifact Claude. Le code source vit ici.

## Ce que ça fait

| | |
|---|---|
| **Saisie libre** | On écrit sans se relire. Clavier, dictée, ou photo d'une page de cours. |
| **Classement** | L'IA trouve la spécialité et la notion clé, parmi celles de la fiche. |
| **Structuration** | Elle rédige l'entrée dans le style du reste de la fiche : texte, liste, tableau comparatif ou mnémo. |
| **Fusion** | Si une entrée proche existe, elle la complète au lieu de la dupliquer. |
| **Refus** | Au moindre doute, elle n'écrit **rien**. Voir plus bas. |
| **Édition à la main** | Toute entrée se corrige directement, sans repasser par l'IA. |
| **Relecture** | Un mode qui enlève tout ce qui n'est pas la fiche, pour la veille de l'examen. |
| **Export** | La fiche entière en Markdown. |

## La règle qui compte

> *« Si l'IA hésite, elle n'écrit rien du tout. »*

C'est l'exigence la plus dure du cahier des charges, et elle tient par quatre
verrous indépendants — aucun n'est un point de défaillance unique :

1. le prompt impose le refus au moindre doute, et interdit tout classement par défaut ;
2. la phase de classement peut répondre `refus`, en motivant ;
3. le JSON est validé contre un schéma strict côté client, et **tout écart déclenche un refus** plutôt qu'un rattrapage silencieux ;
4. **rien n'est écrit sans un clic explicite** sur « Ajouter à la fiche ».

Le quatrième rend les trois autres redondants plutôt que nécessaires : l'IA
propose, elle valide.

## Architecture

```
src/index.html   coquille, styles, thèmes clair et sombre
src/blocks.js    les cinq formes de bloc, leur validation, leur rendu
src/store.js     persistance `db` (un document par notion), repli localStorage
src/ai.js        le pipeline `sample` en deux phases
src/ui.js        rendu et interactions

tools/           import déterministe du PDF d'origine
docs/spec.md     le cahier des charges technique
docs/import.md   comment la structure est reconstruite, et comment c'est vérifié
```

Capabilities déclarées : `db`, `sample`, `downloads`. **Pas `assets`** — une page
qui le déclare devient *organization-internal* et son lien cesse d'être
partageable avec un compte Claude personnel extérieur ; les schémas sont donc
stockés en data-URI dans des documents `db`.

## Le budget de contexte

`sample` plafonne à 65 536 octets par appel, et la fiche en fait déjà 82 000.
D'où deux phases, chacune avec le strict minimum :

1. **classement** — seulement l'*index* (spécialité + titre, ~6 Kio) ;
2. **structuration** — seulement les blocs de la notion visée.

La fiche entière n'est jamais renvoyée.

## L'import

La fiche de départ (28 pages, 25 spécialités, 12 schémas) a été importée **sans
IA**, par un parseur déterministe qui reconstruit la structure à partir de la
géométrie des mots — le PDF ne porte plus ni tableau ni cellule. Son contenu
médical passe donc verbatim, sans reformulation par un modèle.

`tools/verify-import.mjs` le prouve en comparant les multi-ensembles de mots du
PDF et du JSON : **0 mot perdu, 0 mot inventé**, les seules omissions étant
explicitement déclarées. Voir `docs/import.md`.

```sh
node tools/extract-images.mjs fiche.pdf data/images
node tools/parse-fiche.mjs data/fiche.json
node tools/verify-import.mjs data/fiche.json   # échoue si un mot manque
node tools/build-seed.mjs
```

Le contenu de la fiche n'est pas versionné ici : ce dépôt est public, et ce
sont des notes de révision personnelles.
