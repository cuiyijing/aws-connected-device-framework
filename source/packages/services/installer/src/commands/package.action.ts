import chalk from "chalk";
import { Listr, ListrTask } from "listr2";
import { loadModules } from "../models/modules";
import { topologicallySortModules } from "../prompts/modules.prompt";
import { AnswersStorage } from "../utils/answersStorage";
import { S3Utils } from "../utils/s3.util";
import { TagsList } from "../utils/tags";

async function packageAction(
    pathToConfigFile: string
): Promise<void> {
    const answers = await AnswersStorage.loadFromFile(pathToConfigFile);
    const modules = loadModules(answers.environment);

    /**
    * start the template packaging
    **/
    const startedAt = new Date().getTime();

    console.log(chalk.green("\nStarting the packaging...\n"));

    const grouped = topologicallySortModules(
        modules,
        answers.modules.expandedIncludingOptional,
        false
    );

    const listr = new Listr([{
        title: 'Packaging tags parameters',
        task: async () => {
            const s3 = new S3Utils(answers.region);
            const { bucket } = answers.s3
            const tagsList = new TagsList(answers.customTags ?? '');
            await s3.uploadStreamToS3(bucket, `cloudformation/parameters/tags.json`, JSON.stringify(tagsList.asJSONFile()));
        }
    }]);

    await listr.run();

    for (const layer of grouped) {
        const layerTasks: ListrTask[] = [];
        for (const name of layer) {
            const m = modules.find((m) => m.name === name);
            if (m === undefined) {
                throw new Error(`Module ${name} not found!`);
            }
            if (m.package) {
                if (answers.modules.expandedMandatory.includes(m.name) || answers.modules.list.includes(m.name)) {
                    const [_, subTasks] = await m.package(answers);
                    if (subTasks?.length > 0) {
                        layerTasks.push({
                            title: m.friendlyName,
                            task: (_, parentTask): Listr =>
                                parentTask.newListr(subTasks, { concurrent: false }),
                        });
                    }
                }
            } else {
                throw new Error(`Module ${name} has no package functionality defined!`);
            }
        }

        const listr = new Listr(layerTasks, { concurrent: true });
        await listr.run();
    }
    const finishedAt = new Date().getTime();
    const took = (finishedAt - startedAt) / 1000;
    console.log(chalk.bgGreen(`\nDeployment complete! (${took}s)\n`));
}

export default packageAction;