import fs from 'fs';
import path from 'path';

import generateMessages from '@cucumber/gherkin/dist/src/stream/generateMessages';
import {uuid} from '@cucumber/messages/dist/src/IdGenerator';

import * as env from '../configs/env';
import {parseFeature} from './feature';
import {parseSteps} from './steps';
import {generateExampleTableSteps, parseExampleTable} from './table';
import {matchesTags} from './tags';

export function parseSuite(
    cwd,
    feature: string,
    extensions: string[],
    cucumberSupportCode: any
) {
    const featurePath = parseFeature(cwd, feature, extensions);

    const source = fs.readFileSync(featurePath, 'utf8');

    const events = generateMessages(
        source,
        path.normalize(path.relative(cwd, featurePath)),
        {
            includeSource: false,
            includeGherkinDocument: true,
            includePickles: true,
            newId: uuid()
        }
    );

    const document = events[0].gherkinDocument.feature;
    const hasBackground = !!document.children[0].background;
    const specs = hasBackground
        ? document.children.slice(1)
        : document.children;

    const hasExcludeTags = env.EXCLUDE_TAGS.length > 0;
    const hasTags = env.TAGS.length > 0;

    const documentTags = document.tags.map(({name}) => name);
    const documentHasTags =
        documentTags.length > 0 && documentTags.some(matchesTags);
    const shouldSkipFeature = documentTags.includes('@skip');

    const documentContainsSpecsWithTags = specs.some(
        (spec) =>
            spec.scenario.tags.length &&
            spec.scenario.tags.some(({name}) => matchesTags(name))
    );

    const scenarioTags = specs.reduce(
        (acc, spec) => [...acc, ...spec.scenario.tags.map(({name}) => name)],
        []
    );

    const documentHasDebugTag = scenarioTags.includes('@debug');

    const scenarios = specs.reduce((acc, spec) => {
        const tags = spec.scenario.tags.map(({name}) => name);

        const examples = parseExampleTable(spec.scenario.examples);

        const shouldSkipForDebug =
            documentHasDebugTag && !tags.includes('@debug');

        const skip =
            shouldSkipForDebug ||
            tags.includes('@skip') ||
            (hasTags && !!tags.length && !tags.some(matchesTags));

        return [
            ...acc,
            ...(examples.length
                ? generateExampleTableSteps(examples, spec.scenario).map(
                      (spec) => ({
                          ...spec,
                          skip
                      })
                  )
                : [
                      {
                          ...spec.scenario,
                          skip,
                          steps: spec.scenario.steps
                      }
                  ])
        ];
    }, []);

    const skipFeature =
        shouldSkipFeature ||
        (hasTags &&
            !documentHasTags &&
            !documentContainsSpecsWithTags &&
            !hasExcludeTags) ||
        scenarios.length === 0;

    const suites = scenarios.map((scenario) => ({
        ...scenario,
        path: featurePath,
        steps: [
            ...(hasBackground ? document.children[0].background.steps : []),
            ...scenario.steps
        ]
    }));

    return {
        document,
        afterEach: cucumberSupportCode.afterTestCaseHookDefinitions,
        afterAll: cucumberSupportCode.afterTestRunHookDefinitions,
        beforeEach: cucumberSupportCode.beforeTestCaseHookDefinitions,
        beforeAll: cucumberSupportCode.beforeTestRunHookDefinitions,
        skip: skipFeature,
        suites: suites.map((suite) => ({
            ...suite,
            steps: parseSteps(suite.steps, cucumberSupportCode.stepDefinitions)
        }))
    };
}