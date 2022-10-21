import React from 'react';
import { defineMessages, injectIntl } from 'react-intl';
import PropTypes from 'prop-types';
import _ from 'lodash';
import FullscreenButtonContainer from '/imports/ui/components/common/fullscreen-button/container';
import SwitchButtonContainer from './switch-button/container';
import Styled from './styles';
import VolumeSlider from '../external-video-player/volume-slider/component';
import AutoplayOverlay from '../media/autoplay-overlay/component';
import logger from '/imports/startup/client/logger';
import playAndRetry from '/imports/utils/mediaElementPlayRetry';
import { notify } from '/imports/ui/services/notification';
import {
  SCREENSHARE_MEDIA_ELEMENT_NAME,
  screenshareHasEnded,
  screenshareHasStarted,
  getMediaElement,
  attachLocalPreviewStream,
  setVolume,
  getVolume,
} from '/imports/ui/components/screenshare/service';
import {
  isStreamStateUnhealthy,
  subscribeToStreamStateChange,
  unsubscribeFromStreamStateChange,
} from '/imports/ui/services/bbb-webrtc-sfu/stream-state-service';
import { ACTIONS } from '/imports/ui/components/layout/enums';
import Settings from '/imports/ui/services/settings';
import deviceInfo from '/imports/utils/deviceInfo';

const intlMessages = defineMessages({
  screenShareLabel: {
    id: 'app.screenshare.screenShareLabel',
    description: 'screen share area element label',
  },
  presenterLoadingLabel: {
    id: 'app.screenshare.presenterLoadingLabel',
  },
  viewerLoadingLabel: {
    id: 'app.screenshare.viewerLoadingLabel',
  },
  presenterSharingLabel: {
    id: 'app.screenshare.presenterSharingLabel',
  },
  autoplayBlockedDesc: {
    id: 'app.media.screenshare.autoplayBlockedDesc',
  },
  autoplayAllowLabel: {
    id: 'app.media.screenshare.autoplayAllowLabel',
  },
  screenshareStarted: {
    id: 'app.media.screenshare.start',
    description: 'toast to show when a screenshare has started',
  },
  screenshareEnded: {
    id: 'app.media.screenshare.end',
    description: 'toast to show when a screenshare has ended',
  },
  screenshareEndedDueToDataSaving: {
    id: 'app.media.screenshare.endDueToDataSaving',
    description: 'toast to show when a screenshare has ended by changing data savings option',
  },
});

const ALLOW_FULLSCREEN = Meteor.settings.public.app.allowFullscreen;
const MOBILE_HOVER_TIMEOUT = 5000;

class ScreenshareComponent extends React.Component {
  static renderScreenshareContainerInside(mainText) {
    return (
      <Styled.ScreenshareContainerInside>
        <Styled.MainText>{mainText}</Styled.MainText>
      </Styled.ScreenshareContainerInside>
    );
  }

  constructor() {
    super();
    this.state = {
      restoreOnUnmount: true,
      loaded: false,
      autoplayBlocked: false,
      isStreamHealthy: false,
      switched: false,
      // Volume control hover toolbar
      showHoverToolBar: false,
    };

    this.onLoadedData = this.onLoadedData.bind(this);
    this.handleAllowAutoplay = this.handleAllowAutoplay.bind(this);
    this.handlePlayElementFailed = this.handlePlayElementFailed.bind(this);
    this.failedMediaElements = [];
    this.onStreamStateChange = this.onStreamStateChange.bind(this);
    this.onSwitched = this.onSwitched.bind(this);
    this.handleOnVolumeChanged = this.handleOnVolumeChanged.bind(this);
    this.handleOnMuted = this.handleOnMuted.bind(this);

    this.volume = getVolume();
    this.mobileHoverSetTimeout = null;
  }

  componentDidMount() {
    const {
      getSwapLayout,
      toggleSwapLayout,
      layoutContextDispatch,
      intl,
      hidePresentation,
      isPresenter,
    } = this.props;

    screenshareHasStarted(isPresenter);
    // Autoplay failure handling
    window.addEventListener('screensharePlayFailed', this.handlePlayElementFailed);
    // Stream health state tracker to propagate UI changes on reconnections
    subscribeToStreamStateChange('screenshare', this.onStreamStateChange);
    // Attaches the local stream if it exists to serve as the local presenter preview
    attachLocalPreviewStream(getMediaElement());

    notify(intl.formatMessage(intlMessages.screenshareStarted), 'info', 'desktop');

    if (getSwapLayout()) {
      toggleSwapLayout(layoutContextDispatch)
      this.setState({ restoreOnUnmount: false });
    };

    layoutContextDispatch({
      type: ACTIONS.SET_HAS_SCREEN_SHARE,
      value: true,
    });

    if (hidePresentation) {
      layoutContextDispatch({
        type: ACTIONS.SET_PRESENTATION_IS_OPEN,
        value: true,
      });
    }
  }

  componentDidUpdate(prevProps) {
    const {
      isPresenter,
    } = this.props;
    if (prevProps.isPresenter && !isPresenter) {
      screenshareHasEnded();
    }
  }

  componentWillUnmount() {
    const {
      intl,
      fullscreenContext,
      layoutContextDispatch,
      hidePresentation,
      toggleSwapLayout,
    } = this.props;
    const { restoreOnUnmount } = this.state;
    screenshareHasEnded();
    window.removeEventListener('screensharePlayFailed', this.handlePlayElementFailed);
    unsubscribeFromStreamStateChange('screenshare', this.onStreamStateChange);

    if (Settings.dataSaving.viewScreenshare) {
      notify(intl.formatMessage(intlMessages.screenshareEnded), 'info', 'desktop');
    } else {
      notify(intl.formatMessage(intlMessages.screenshareEndedDueToDataSaving), 'info', 'desktop');
    }

    layoutContextDispatch({
      type: ACTIONS.SET_HAS_SCREEN_SHARE,
      value: false,
    });

    if (fullscreenContext) {
      layoutContextDispatch({
        type: ACTIONS.SET_FULLSCREEN_ELEMENT,
        value: {
          element: '',
          group: '',
        },
      });
    }

    if (hidePresentation || !restoreOnUnmount) {
      layoutContextDispatch({
        type: ACTIONS.SET_PRESENTATION_IS_OPEN,
        value: false,
      });
      toggleSwapLayout(layoutContextDispatch);
    }
  }

  handleAllowAutoplay() {
    const { autoplayBlocked } = this.state;

    logger.info({
      logCode: 'screenshare_autoplay_allowed',
    }, 'Screenshare media autoplay allowed by the user');

    window.removeEventListener('screensharePlayFailed', this.handlePlayElementFailed);
    while (this.failedMediaElements.length) {
      const mediaElement = this.failedMediaElements.shift();
      if (mediaElement) {
        const played = playAndRetry(mediaElement);
        if (!played) {
          logger.error({
            logCode: 'screenshare_autoplay_handling_failed',
          }, 'Screenshare autoplay handling failed to play media');
        } else {
          logger.info({
            logCode: 'screenshare_viewer_media_play_success',
          }, 'Screenshare viewer media played successfully');
        }
      }
    }
    if (autoplayBlocked) { this.setState({ autoplayBlocked: false }); }
  }

  handlePlayElementFailed(e) {
    const { mediaElement } = e.detail;
    const { autoplayBlocked } = this.state;

    e.stopPropagation();
    this.failedMediaElements.push(mediaElement);
    if (!autoplayBlocked) {
      logger.info({
        logCode: 'screenshare_autoplay_prompt',
      }, 'Prompting user for action to play screenshare media');

      this.setState({ autoplayBlocked: true });
    }
  }

  onStreamStateChange(event) {
    const { streamState } = event.detail;
    const { isStreamHealthy } = this.state;

    const newHealthState = !isStreamStateUnhealthy(streamState);
    event.stopPropagation();
    if (newHealthState !== isStreamHealthy) {
      this.setState({ isStreamHealthy: newHealthState });
    }
  }

  onLoadedData() {
    this.setState({ loaded: true });
  }

  onSwitched() {
    this.setState((prevState) => ({ switched: !prevState.switched }));
  }

  handleOnVolumeChanged(volume) {
    this.volume = volume;
    setVolume(volume);
  }

  handleOnMuted(muted) {
    if (muted) {
      setVolume(0);
    } else {
      setVolume(this.volume);
    }
  }

  renderFullscreenButton() {
    const { intl, fullscreenElementId, fullscreenContext } = this.props;

    if (!ALLOW_FULLSCREEN) return null;

    return (
      <FullscreenButtonContainer
        key={_.uniqueId('fullscreenButton-')}
        elementName={intl.formatMessage(intlMessages.screenShareLabel)}
        fullscreenRef={this.screenshareContainer}
        elementId={fullscreenElementId}
        isFullscreen={fullscreenContext}
        dark
      />
    );
  }

  renderAutoplayOverlay() {
    const { intl } = this.props;

    return (
      <AutoplayOverlay
        key={_.uniqueId('screenshareAutoplayOverlay')}
        autoplayBlockedDesc={intl.formatMessage(intlMessages.autoplayBlockedDesc)}
        autoplayAllowLabel={intl.formatMessage(intlMessages.autoplayAllowLabel)}
        handleAllowAutoplay={this.handleAllowAutoplay}
      />
    );
  }

  renderSwitchButton() {
    const { switched } = this.state;

    return (
      <SwitchButtonContainer
        handleSwitch={this.onSwitched}
        switched={switched}
        dark
      />
    );
  }

  renderMobileVolumeControlOverlay () {
    return (
      <Styled.MobileControlsOverlay
        key="mobile-overlay-screenshare"
        ref={(ref) => { this.overlay = ref; }}
        onTouchStart={() => {
          clearTimeout(this.mobileHoverSetTimeout);
          this.setState({ showHoverToolBar: true });
        }}
        onTouchEnd={() => {
          this.mobileHoverSetTimeout = setTimeout(
            () => this.setState({ showHoverToolBar: false }),
            MOBILE_HOVER_TIMEOUT,
          );
        }}
      />
    );
  }

  renderVolumeSlider() {
    const { showHoverToolBar } = this.state;

    let toolbarStyle = 'hoverToolbar';

    if (deviceInfo.isMobile && !showHoverToolBar) {
      toolbarStyle = 'dontShowMobileHoverToolbar';
    }

    if (deviceInfo.isMobile && showHoverToolBar) {
      toolbarStyle = 'showMobileHoverToolbar';
    }
  

    return [(
      <Styled.HoverToolbar
        toolbarStyle={toolbarStyle}
        key='hover-toolbar-screenshare'>
        <VolumeSlider
          volume={getVolume()}
          muted={getVolume() === 0}
          onVolumeChanged={this.handleOnVolumeChanged}
          onMuted={this.handleOnMuted}
        />
      </Styled.HoverToolbar>
      ),
      (deviceInfo.isMobile) && this.renderMobileVolumeControlOverlay(),
    ];
  }

  renderVideo(switched) {
    const { isGloballyBroadcasting } = this.props;

    return (
      <Styled.ScreenshareVideo
        id={SCREENSHARE_MEDIA_ELEMENT_NAME}
        key={SCREENSHARE_MEDIA_ELEMENT_NAME}
        unhealthyStream={!isGloballyBroadcasting}
        style={switched
          ? { maxHeight: '100%', width: '100%', height: '100%' }
          : { maxHeight: '25%', width: '25%', height: '25%' }}
        playsInline
        onLoadedData={this.onLoadedData}
        ref={(ref) => {
          this.videoTag = ref;
        }}
        muted
      />
    );
  }

  renderScreensharePresenter() {
    const { switched } = this.state;
    const { isGloballyBroadcasting, intl } = this.props;

    return (
      <Styled.ScreenshareContainer
        switched={switched}
        key="screenshareContainer"
        ref={(ref) => { this.screenshareContainer = ref; }}
      >
        {isGloballyBroadcasting && this.renderSwitchButton()}
        {this.renderVideo(switched)}

        {
          isGloballyBroadcasting
            ? (
              <div data-test="isSharingScreen">
                {!switched
                  && ScreenshareComponent.renderScreenshareContainerInside(
                    intl.formatMessage(intlMessages.presenterSharingLabel),
                  )}
              </div>
            )
            : ScreenshareComponent.renderScreenshareContainerInside(
              intl.formatMessage(intlMessages.presenterLoadingLabel),
            )
        }
      </Styled.ScreenshareContainer>
    );
  }

  renderScreenshareDefault() {
    const { intl, enableVolumeControl } = this.props;
    const { loaded } = this.state;

    return (
      <Styled.ScreenshareContainer
        switched
        key="screenshareContainer"
        ref={(ref) => {
          this.screenshareContainer = ref;
        }}
        id="screenshareContainer"
      >
        {loaded && this.renderFullscreenButton()}
        {this.renderVideo(true)}
        {loaded && enableVolumeControl && this.renderVolumeSlider() }

        <Styled.ScreenshareContainerDefault>
          {
            !loaded
              ? ScreenshareComponent.renderScreenshareContainerInside(
                intl.formatMessage(intlMessages.viewerLoadingLabel),
              )
              : null
          }
        </Styled.ScreenshareContainerDefault>
      </Styled.ScreenshareContainer>
    );
  }

  render() {
    const { loaded, autoplayBlocked, isStreamHealthy } = this.state;
    const {
      isPresenter,
      isGloballyBroadcasting,
      top,
      left,
      right,
      width,
      height,
      zIndex,
      fullscreenContext,
    } = this.props;

    // Conditions to render the (re)connecting dots and the unhealthy stream
    // grayscale:
    // 1 - The local media tag has not received any stream data yet
    // 2 - The user is a presenter and the stream wasn't globally broadcasted yet
    // 3 - The media was loaded, the stream was globally broadcasted BUT the stream
    // state transitioned to an unhealthy stream. tl;dr: screen sharing reconnection
    const shouldRenderConnectingState = !loaded
      || (isPresenter && !isGloballyBroadcasting)
      || (!isStreamHealthy && loaded && isGloballyBroadcasting);

    const display = (width > 0 && height > 0) ? 'inherit' : 'none';
    const { animations } = Settings.application;

    return (
      <div
        style={
          {
            position: 'absolute',
            display,
            top,
            left,
            right,
            height,
            width,
            zIndex: fullscreenContext ? zIndex : undefined,
            backgroundColor: '#06172A',
          }
        }
      >
        {(shouldRenderConnectingState)
          && (
            <Styled.SpinnerWrapper
              key={_.uniqueId('screenshareArea-')}
              data-test="screenshareConnecting"
            >
              <Styled.Spinner animations={animations}>
                <Styled.Bounce1 animations={animations} />
                <Styled.Bounce2 animations={animations} />
                <div />
              </Styled.Spinner>
            </Styled.SpinnerWrapper>
          )}
        {autoplayBlocked ? this.renderAutoplayOverlay() : null}
        {isPresenter ? this.renderScreensharePresenter() : this.renderScreenshareDefault()}
      </div>
    );
  }
}

export default injectIntl(ScreenshareComponent);

ScreenshareComponent.propTypes = {
  intl: PropTypes.shape({
    formatMessage: PropTypes.func.isRequired,
  }).isRequired,
  isPresenter: PropTypes.bool.isRequired,
  enableVolumeControl: PropTypes.bool.isRequired,
};