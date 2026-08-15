const { IOSConfig, withXcodeProject } = require('@expo/config-plugins');

/**
 * Keep local device signing reproducible after Expo regenerates the ignored
 * native project. The team itself comes from ios.appleTeamId.
 */
module.exports = (config) =>
  withXcodeProject(config, (xcodeConfig) => {
    const teamId = xcodeConfig.ios?.appleTeamId;

    for (const [targetId, target] of IOSConfig.Target.getNativeTargets(xcodeConfig.modResults)) {
      for (const [, buildConfig] of IOSConfig.XcodeUtils.getBuildConfigurationsForListId(
        xcodeConfig.modResults,
        target.buildConfigurationList,
      )) {
        buildConfig.buildSettings.CODE_SIGN_STYLE = 'Automatic';
      }

      for (const [, project] of Object.entries(
        IOSConfig.XcodeUtils.getProjectSection(xcodeConfig.modResults),
      ).filter(IOSConfig.XcodeUtils.isNotComment)) {
        project.attributes.TargetAttributes[targetId] ??= {};
        project.attributes.TargetAttributes[targetId].ProvisioningStyle = 'Automatic';

        if (teamId) {
          project.attributes.TargetAttributes[targetId].DevelopmentTeam = teamId;
        }
      }
    }

    return xcodeConfig;
  });
