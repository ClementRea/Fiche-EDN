# Fiche EDN — cahier des charges technique

> Spec de mise en œuvre. Le cahier des charges fonctionnel d'origine est en
> annexe (`docs/cahier-des-charges.md`), la maquette de référence est le
> projet Claude Design `a00e49cc-b28e-4d0a-bf3a-c7e5ca7d1d16`.

## 1. Objectif

Donner à une étudiante en médecine préparant les EDN une plateforme où elle
ajoute une information **sans avoir à la rédiger proprement**, et où la fiche
se classe, se structure et se complète toute seule — accessible partout,
persistante.

Le projet ne part pas d'une page blanche : sa fiche existante (28 pages,
22 spécialités, format deux colonnes « Notion clé / Ce qu'il faut retenir »)
est importée telle quelle au démarrage.

## 2. Forme retenue

Artifact Claude publié, code source versionné ici. Pas de site indépendant,
pas de clé API à gérer, pas de base externe.

| Capability | Usage | Pourquoi |
|---|---|---|
| `db` | stockage des notions, méta, images | persistance multi-appareils |
| `sample` | classement + structuration | appelle Claude sur le compte de la lectrice |
| `downloads` | export/sauvegarde de la fiche | filet de sécurité avant l'examen |

**`assets` est délibérément exclu.** Une page qui déclare `assets` devient
*organization-internal, never public* : le lien ne serait plus partageable
avec un compte Claude personnel extérieur à l'organisation. Les schémas sont
donc stockés en data-URI redimensionnée dans des documents `db` dédiés.

## 3. Modèle de données

Le cap `db` est de **256 KiB par document**, d'où un document par notion
plutôt qu'un gros document fiche.

```
meta/fiche      { specOrder[], importedAt, schemaVersion }
notions/<id>    { id, spec, title, item, ai, blocks[], order,
                  createdAt, updatedAt }
images/<id>     { dataUrl, caption }
```

Un `block` est l'une de ces cinq formes — les cinq que sa fiche utilise déjà :

```
{ type: "text",   text }
{ type: "list",   items[] }
{ type: "table",  head[], rows[][] }
{ type: "mnemo",  text }
{ type: "schema", imageId?, text }
```

## 4. Pipeline IA — budget de contexte

`sample` plafonne à **65 536 octets par appel** et la fiche en fait déjà
82 000. Renvoyer la fiche entière est donc impossible autant qu'interdit
(cahier des charges §4). Deux phases, chacune avec le minimum de contexte :

**Phase 1 — classement.** Entrée : l'*index* seul (spécialités + titres de
notions, ~6 KB) et le texte brut. Sortie JSON :
`{ decision: "merge"|"new"|"refus", spec, notionId, notionTitle, reasons[] }`.

**Phase 2 — structuration.** Entrée : les blocs de *la seule notion cible*
et le texte brut. Sortie JSON : `{ blocks[], note }`.

La phase 2 n'est jamais atteinte si la phase 1 refuse.

## 5. La règle anti-erreur

*« Si l'IA hésite, elle n'écrit rien du tout. »* — l'exigence la plus dure du
cahier des charges (§5.6). Quatre verrous indépendants, de sorte qu'aucun ne
soit un point de défaillance unique :

1. **Prompt** — consigne explicite de refuser au moindre doute sur le
   classement, le contenu ou la mise en forme ; aucun classement par défaut.
2. **Refus structuré** — la phase 1 peut répondre `refus` en motivant.
3. **Validation stricte** — le JSON est vérifié contre un schéma côté client.
   Tout écart (champ manquant, type inattendu, spécialité inconnue, ligne de
   tableau de largeur incohérente) **déclenche un refus**, jamais un
   rattrapage silencieux.
4. **Confirmation humaine** — rien n'est écrit sans un clic explicite sur
   « Ajouter à la fiche ». L'IA propose, elle n'écrit pas.

Le verrou 4 est le plus important : il rend les trois autres redondants
plutôt que nécessaires.

## 6. Saisie

- **Clavier / coller** — mode par défaut, saisie libre non relue.
- **Dictée** — `webkitSpeechRecognition` quand le navigateur la fournit.
  Sur Safari elle existe (iOS 14.5+ / macOS 14.1+) mais coupe aux pauses ;
  quand elle est absente ou échoue, l'interface renvoie vers la dictée
  système Apple (micro du clavier iOS, Fn Fn sur macOS), qui écrit
  directement dans le champ et reste la voie la plus fiable.
- **Photo** — une page de cours ou de fiche papier est envoyée à `sample`
  comme image. Remplace la piste « audio → transcription IA » du cahier des
  charges §6, **techniquement impossible** : `sample` accepte du texte et des
  images, jamais de l'audio.

## 7. Import

L'import initial est fait **hors application, de façon déterministe**, et le
résultat est écrit directement dans `db`. Son contenu existant passe
verbatim : aucune reformulation par un modèle, donc aucun risque
d'altération sur 22 spécialités qu'elle a déjà vérifiées, et aucune
consommation sur son quota.

L'écran d'import reste dans l'application, alimenté par l'IA, pour les ajouts
ultérieurs (coller du texte, photographier une page).

## 8. Hors périmètre

Partage multi-utilisateurs, révision espacée, quiz, statistiques de
révision, application native.
